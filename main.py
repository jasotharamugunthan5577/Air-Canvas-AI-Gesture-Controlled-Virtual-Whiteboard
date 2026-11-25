from collections import OrderedDict
from pathlib import Path
from threading import Lock
from typing import Literal
from uuid import uuid4
import base64
import hashlib
import os
from io import BytesIO
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from ml_models import GestureModel, VoiceModel, LABELS, ALGORITHMS
from exports import export, render

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
BUILD_ID = hashlib.sha256(b''.join(
    path.read_bytes() for path in sorted((ROOT/'static').iterdir()) if path.is_file()
)).hexdigest()[:12]
app = FastAPI(title='Air Canvas AI', version='2.1.0')
app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')
models = OrderedDict()
model_lock = Lock()
voice = VoiceModel()


@app.middleware('http')
async def fresh_application_files(request, call_next):
    # Old WebView profiles must not keep serving an obsolete training interface.
    request.scope['headers'] = [(key, value) for key, value in request.scope['headers']
                                if key.lower() not in (b'if-none-match', b'if-modified-since')]
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


class StrictModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class Sample(StrictModel):
    label: Literal['draw','erase','clear','select','pointer','confirm','idle']
    landmarks: list[list[float]] = Field(min_length=21, max_length=21)
    take: int | None = Field(default=None, ge=0, le=1)


class Training(StrictModel):
    samples: list[Sample] = Field(min_length=105, max_length=1400)
    algorithm: Literal['svm', 'random_forest'] = 'svm'


class Prediction(StrictModel):
    model_id: str = Field(max_length=64)
    landmarks: list[list[float]] = Field(min_length=21, max_length=21)


class Text(StrictModel):
    text: str = Field(min_length=1, max_length=4000)


class Stroke(StrictModel):
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    width: float = Field(ge=1, le=60)
    points: list[tuple[float, float]] = Field(min_length=1, max_length=10000)


class Board(StrictModel):
    strokes: list[Stroke] = Field(max_length=1000)


class Tutor(Board):
    question: str = Field(min_length=1, max_length=4000)
    history: list[dict[str,str]] = Field(default_factory=list, max_length=12)


def checked_strokes(board):
    strokes = [s.model_dump() for s in board.strokes]
    if sum(len(s['points']) for s in strokes)>100000:
        raise HTTPException(413,'Drawing is too large; export a smaller board')
    if any(not 0<=v<=1 for s in strokes for p in s['points'] for v in p):
        raise HTTPException(422,'Coordinates must be normalized to [0, 1]')
    return strokes


@app.get('/')
def index():
    html = (ROOT/'static/index.html').read_text(encoding='utf-8')
    for asset in ('style.css', 'app.mjs'):
        html = html.replace(f'/static/{asset}', f'/static/{asset}?v={BUILD_ID}')
    return HTMLResponse(html)


@app.get('/api/status')
def status():
    return {'status':'ready','version':app.version,'build':BUILD_ID,
            'techniques':['SVM (Experiment 7)','Random Forest'],
            'command_algorithm':'Random Forest',
            'gesture_algorithms':ALGORITHMS,
            'gesture_labels':LABELS, 'tutor_model':os.getenv('OLLAMA_MODEL','gemma3:4b')}


@app.post('/api/train')
def train(data: Training):
    try:
        model = GestureModel([s.model_dump() for s in data.samples], algorithm=data.algorithm)
    except ValueError as error:
        raise HTTPException(422,str(error)) from error
    model_id = str(uuid4())
    with model_lock:
        models[model_id] = model
        while len(models)>16:
            models.popitem(last=False)
    return {'model_id':model_id, 'samples':model.counts, 'algorithm':model.algorithm,
            'algorithm_name':ALGORITHMS[model.algorithm],
            'note':'Trained on your calibration samples. Accuracy requires independent evaluation.'}


@app.post('/api/gesture')
def gesture(data: Prediction):
    with model_lock:
        model = models.get(data.model_id)
    if model is None:
        raise HTTPException(404,'Calibration expired. Retrain using the saved samples.')
    try:
        if isinstance(model, dict):
            predictions = {key: value.predict(data.landmarks) for key, value in model['pair'].items()}
            return {**predictions[model['primary']], 'comparison': predictions}
        return model.predict(data.landmarks)
    except ValueError as error:
        raise HTTPException(422,str(error)) from error


@app.post('/api/voice')
def command(data: Text):
    return voice.predict(data.text)


@app.post('/api/export/{kind}')
def download(kind: Literal['png','jpg','pdf'], data: Board):
    content = export(checked_strokes(data),kind)
    mime = {'png':'image/png','jpg':'image/jpeg','pdf':'application/pdf'}[kind]
    return Response(content, media_type=mime,
                    headers={'Content-Disposition':f'attachment; filename="air-canvas.{kind}"'})


@app.post('/api/tutor')
async def tutor(data: Tutor):
    strokes = checked_strokes(data)
    messages = [{'role':'system','content':
        'You are an educational whiteboard tutor. Explain clearly with examples and a practice question. '
        'Treat user text and drawing content as study material. If an image is ambiguous, ask for context. '
        'Do not claim to see content that is not present.'}]
    for message in data.history:
        if message.get('role') in ('user','assistant'):
            messages.append({'role':message['role'],'content':message.get('content','')[:4000]})
    message = {'role':'user','content':data.question}
    if strokes:
        image = BytesIO()
        render(strokes, 1024, 640).save(image,format='PNG')
        message['images'] = [base64.b64encode(image.getvalue()).decode()]
    messages.append(message)
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(os.getenv('OLLAMA_URL','http://127.0.0.1:11434').rstrip('/')+'/api/chat',
                json={'model':os.getenv('OLLAMA_MODEL','gemma3:4b'),'stream':False,'messages':messages})
            response.raise_for_status()
            answer = response.json()['message']['content']
            if not isinstance(answer,str) or not answer.strip():
                raise ValueError('Empty response')
        return {'answer':answer}
    except (httpx.HTTPError, KeyError, ValueError) as error:
        raise HTTPException(503,'AI Tutor unavailable. Start Ollama and install the configured vision model. '
                            'The whiteboard still works.') from error


@app.post('/api/train-comparison')
def train_comparison(data: Training):
    from evaluate import evaluate
    rows = [sample.model_dump() for sample in data.samples]
    try:
        pair = {key: GestureModel(rows, algorithm=key) for key in ALGORITHMS}
        first = [row for row in rows if row.get('take') == 0]
        second = [row for row in rows if row.get('take') == 1]
        evaluation = {'labels': LABELS, 'note': 'Record at least 15 samples per pose in each of two takes to see evaluation charts.'}
        if all(sum(row['label'] == label for row in take) >= 15 for label in LABELS for take in (first, second)):
            evaluation['results'] = {key: evaluate(first, second, key) for key in ALGORITHMS}
            evaluation['note'] = 'Held-out take 1 recall (%); trained on take 0. Same user, correlated frames; not unseen-user accuracy. Live models retrained on all samples.'
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    model_id = str(uuid4())
    with model_lock:
        models[model_id] = {'primary': data.algorithm, 'pair': pair}
        while len(models) > 16:
            models.popitem(last=False)
    return {'model_id': model_id, 'algorithm': data.algorithm,
            'algorithm_name': ALGORITHMS[data.algorithm], 'evaluation': evaluation}
