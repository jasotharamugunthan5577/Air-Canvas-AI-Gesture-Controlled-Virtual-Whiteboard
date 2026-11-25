from io import BytesIO
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from main import app
from ml_models import features, GestureModel, LABELS
from ml_models import VoiceModel

client = TestClient(app)


def test_exports():
    board = {'strokes':[{'color':'#4667ee','width':10,'points':[[.1,.5],[.9,.5]]}]}
    for kind in ('png','jpg','pdf'):
        response = client.post('/api/export/'+kind,json=board)
        assert response.status_code == 200
        if kind=='pdf':
            assert response.content.startswith(b'%PDF')
        else:
            image = Image.open(BytesIO(response.content))
            assert image.size==(1600,1000)
            assert image.getpixel((800,500)) != (255,255,255)
            assert image.getpixel((10,10)) == (255,255,255)


def test_invalid_requests():
    assert client.post('/api/export/png',json={'strokes':[{'color':'red','width':1,'points':[[0,0]]}]}).status_code==422
    assert client.post('/api/export/png',json={'strokes':[{'color':'#000000','width':1,'points':[[-1,0]]}]}).status_code==422
    assert client.post('/api/gesture',json={'model_id':'missing','landmarks':[[0,0,0]]*21}).status_code==404
    assert client.post('/api/train',json={'samples':[]}).status_code==422
    assert client.get('/').status_code==200


def test_features_are_translation_scale_invariant():
    rng=np.random.default_rng(12)
    hand=rng.normal(size=(21,3))
    np.testing.assert_allclose(features(hand),features(hand*3+[2,5,1]),atol=1e-6)
    with pytest.raises(ValueError):features([[0,0,0]]*21)


@pytest.mark.parametrize('algorithm',['svm','random_forest'])
def test_gesture_models_learn_labels_from_samples(algorithm):
    # Artificial fixtures test the algorithm only; never shipped as gesture training data.
    rng=np.random.default_rng(7)
    centers={label:rng.normal(size=(21,3)) for label in LABELS}
    samples=[{'label':label,'landmarks':(center+rng.normal(0,.003,(21,3))).tolist()}
             for label,center in centers.items() for _ in range(20)]
    model=GestureModel(samples,algorithm=algorithm)
    if algorithm=='svm':
        from sklearn.svm import SVC
        assert isinstance(model.pipeline.named_steps['classifier'],SVC)
    elif algorithm=='random_forest':
        from sklearn.ensemble import RandomForestClassifier
        assert isinstance(model.pipeline.named_steps['classifier'],RandomForestClassifier)
    for label,center in centers.items():
        result=model.predict(center+rng.normal(0,.003,(21,3)))
        assert result['gesture']==label
        # SVM's calibrated probabilities need not match forest vote scores.
        assert .5 < result['confidence'] <= 1
        assert result['algorithm']==algorithm
    outlier=centers['draw'].copy()
    outlier[4]+=1000
    assert model.predict(outlier)['confidence']==0
    response=client.post('/api/train',json={'samples':samples,'algorithm':algorithm})
    assert response.status_code==200
    assert response.json()['algorithm']==algorithm
    prediction=client.post('/api/gesture',json={'model_id':response.json()['model_id'],'landmarks':centers['draw'].tolist()})
    assert prediction.json()['gesture']=='draw'
    assert prediction.json()['algorithm']==algorithm


def test_invalid_algorithm_is_rejected():
    with pytest.raises(ValueError,match='Choose'):
        GestureModel([],algorithm='unsupported')
    samples=[{'label':'idle','landmarks':[[0,0,0]]*21}]*105
    assert client.post('/api/train',json={'samples':samples,'algorithm':'unsupported'}).status_code==422


def test_algorithm_choices_are_discoverable():
    response=client.get('/api/status')
    assert set(response.json()['gesture_algorithms'])=={'svm','random_forest'}


def test_updated_interface_cannot_be_served_from_stale_cache():
    status=client.get('/api/status').json()
    page=client.get('/')
    assert f'/static/app.mjs?v={status["build"]}' in page.text
    assert 'no-store' in page.headers['cache-control']
    asset=client.get('/static/app.mjs')
    conditional=client.get('/static/app.mjs',headers={'If-None-Match':asset.headers['etag']})
    assert conditional.status_code==200
    assert 'no-store' in conditional.headers['cache-control']


@pytest.mark.parametrize('text,intent',[
    ('undo','undo'),('redo','redo'),('clear the canvas','clear'),
    ('change pen color to blue','color'),('make the brush thinner','thinner'),
    ('increase brush thickness','thicker'),('export as pdf','export'),
    ('use eraser','eraser'),('explain this diagram','tutor'),
    ("don't clear canvas",'cancel'),('zqxv blorp','unknown'),
])
def test_voice(text,intent):
    result=VoiceModel().predict(text)
    assert result['intent']==intent


def test_tutor_failure_is_graceful(monkeypatch):
    import httpx
    async def unavailable(*args,**kwargs):raise httpx.ConnectError('offline')
    monkeypatch.setattr(httpx.AsyncClient,'post',unavailable)
    response=client.post('/api/tutor',json={'question':'Explain this','strokes':[]})
    assert response.status_code==503
    assert client.get('/api/status').status_code==200

def test_comparison_preserves_take_split_and_returns_both_predictions(monkeypatch):
    import evaluate
    calls = []
    def check_split(train, test, algorithm):
        assert all(row['take'] == 0 for row in train)
        assert all(row['take'] == 1 for row in test)
        calls.append(algorithm)
        return {'accuracy': 0.5}
    monkeypatch.setattr(evaluate, 'evaluate', check_split)
    rng = np.random.default_rng(82)
    centers = {label: rng.normal(size=(21, 3)) for label in LABELS}
    rows = [{'label': label, 'take': take,
             'landmarks': (center + rng.normal(0, .003, (21, 3))).tolist()}
            for label, center in centers.items() for take in (0, 1) for _ in range(15)]
    response = client.post('/api/train-comparison', json={'samples': rows, 'algorithm': 'random_forest'})
    assert response.status_code == 200
    assert set(calls) == {'svm', 'random_forest'}
    prediction = client.post('/api/gesture', json={'model_id': response.json()['model_id'],
                            'landmarks': centers['draw'].tolist()}).json()
    assert prediction['algorithm'] == 'random_forest'
    assert set(prediction['comparison']) == {'svm', 'random_forest'}
    assert prediction['comparison']['svm']['gesture'] == 'draw'
    assert prediction['comparison']['random_forest']['gesture'] == 'draw'
