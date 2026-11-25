"""Library-based SVM and Random Forest models for Air Canvas AI."""
from collections import Counter
import re
import numpy as np
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer

LABELS = ('draw', 'erase', 'clear', 'select', 'pointer', 'confirm', 'idle')
ALGORITHMS = {'svm': 'SVM (RBF kernel)', 'random_forest': 'Random Forest (150 trees)'}


def features(landmarks):
    p = np.asarray(landmarks, dtype=float)
    if p.shape != (21, 3) or not np.isfinite(p).all():
        raise ValueError('Expected 21 finite XYZ landmarks')
    scale = np.linalg.norm(p[9] - p[0])
    if scale < 1e-5:
        raise ValueError('Hand landmarks are degenerate')
    # Distances and joint cosines tolerate translation, scale and handedness.
    values = []
    for start in (1, 5, 9, 13, 17):
        for joint in (start + 1, start + 2):
            a, b = p[joint-1]-p[joint], p[joint+1]-p[joint]
            values.append(np.dot(a, b)/(np.linalg.norm(a)*np.linalg.norm(b)+1e-8))
        values.append(np.linalg.norm(p[start+3]-p[0])/scale)
    for tip in (8, 12, 16, 20):
        values.append(np.linalg.norm(p[4]-p[tip])/scale)
    # Thumb direction distinguishes a thumbs-up from a sideways closed hand.
    values.extend(((p[4]-p[2])/scale).tolist())
    return np.asarray(values)


CORPUS = {
    'undo': ['undo', 'undo last stroke', 'go back', 'remove my last action', 'undo that'],
    'redo': ['redo', 'redo last stroke', 'bring it back', 'restore last action', 'redo that'],
    'clear': ['clear canvas', 'clear the board', 'erase everything', 'delete all strokes', 'start over'],
    'pen': ['start drawing', 'use pen', 'switch to pen', 'draw mode', 'select the pen tool'],
    'eraser': ['use eraser', 'eraser mode', 'erase a stroke', 'switch to eraser', 'select eraser tool'],
    'color': ['change pen color to blue', 'make ink red', 'use green color', 'select purple color', 'change color'],
    'thicker': ['increase brush thickness', 'make brush thicker', 'larger brush', 'increase brush size', 'thick pen'],
    'thinner': ['decrease brush thickness', 'make brush thinner', 'smaller brush', 'decrease brush size', 'thin pen'],
    'export': ['export drawing', 'save as png', 'download pdf', 'export as jpg', 'save my whiteboard'],
    'confirm': ['confirm', 'yes clear it', 'confirm clear', 'yes delete everything', 'accept'],
    'cancel': ['cancel', 'cancel clear', 'keep my drawing', 'no stop', 'never mind'],
    'tutor': ['explain this diagram', 'teach me sorting', 'what is a binary tree', 'quiz me', 'solve this problem',
              'summarize the drawing', 'give me an example', 'help me learn', 'how does this work'],
}
COLORS = {'black':'#172033', 'red':'#e84f62', 'blue':'#4667ee', 'green':'#159879',
          'yellow':'#e9b52b', 'purple':'#8b5cf6', 'orange':'#ef883c', 'pink':'#dc5caa'}


class GestureModel:
    """Fit a scikit-learn pipeline on real labelled landmark samples."""
    def __init__(self, samples, algorithm='svm'):
        if algorithm not in ALGORITHMS:
            raise ValueError('Choose svm or random_forest')
        self.algorithm = algorithm
        self.counts = dict(Counter(s['label'] for s in samples))
        if set(self.counts)-set(LABELS):
            raise ValueError('Unknown gesture label')
        if any(self.counts.get(label, 0) < 15 for label in LABELS):
            raise ValueError('Capture at least 15 samples for each of the seven poses')
        x = np.array([features(s['landmarks']) for s in samples])
        y = [s['label'] for s in samples]
        if algorithm == 'svm':
            classifier = SVC(kernel='rbf', C=10, gamma='scale', probability=True,
                             class_weight='balanced', random_state=42)
        else:
            classifier = RandomForestClassifier(n_estimators=150, max_depth=12,
                min_samples_leaf=2, max_features='sqrt', bootstrap=True,
                class_weight='balanced', random_state=42, n_jobs=1)
        self.pipeline = Pipeline([('scale', StandardScaler()), ('classifier', classifier)])
        self.pipeline.fit(x, y)
        # Basic input-range guard, not another learned classification algorithm.
        scaled = self.pipeline.named_steps['scale'].transform(x)
        self.lower, self.upper = scaled.min(axis=0)-3, scaled.max(axis=0)+3

    def predict(self, landmarks):
        x = features(landmarks).reshape(1, -1)
        scaled = self.pipeline.named_steps['scale'].transform(x)[0]
        if np.any(scaled < self.lower) or np.any(scaled > self.upper):
            return {'gesture':'idle', 'confidence':0., 'algorithm':self.algorithm}
        probabilities = self.pipeline.predict_proba(x)[0]
        index = int(np.argmax(probabilities))
        return {'gesture':str(self.pipeline.classes_[index]),
                'confidence':float(probabilities[index]), 'algorithm':self.algorithm}


class VoiceModel:
    """TF-IDF text features and a library Random Forest command classifier."""
    def __init__(self):
        texts, labels = zip(*[(text, label) for label, rows in CORPUS.items() for text in rows])
        self.pipeline = Pipeline([
            ('text', TfidfVectorizer(ngram_range=(1, 2))),
            ('classifier', RandomForestClassifier(n_estimators=200, max_features=None,
                class_weight='balanced', random_state=42, n_jobs=1)),
        ])
        self.pipeline.fit(texts, labels)

    def predict(self, text):
        text = text.lower().strip()
        result = {'intent':'unknown', 'confidence':0., 'parameter':None,
                  'algorithm':'random_forest', 'algorithm_name':'Random Forest'}
        # Negation blocks commands; entity extraction supplies color/format values.
        if re.search(r"\b(don't|do not|never|not)\b", text):
            return {**result, 'intent':'cancel', 'confidence':1.}
        if self.pipeline.named_steps['text'].transform([text]).nnz == 0:
            return result
        probabilities = self.pipeline.predict_proba([text])[0]
        index = int(np.argmax(probabilities))
        confidence = float(probabilities[index])
        intent = str(self.pipeline.classes_[index]) if confidence >= .3 else 'unknown'
        parameter = None
        if intent == 'color':
            parameter = next((v for k,v in COLORS.items() if re.search(r'\b'+k+r'\b', text)), None)
            if parameter is None:
                intent = 'unknown'
        elif intent == 'export':
            parameter = next((fmt for fmt in ('pdf','jpg','png') if fmt in text), 'png')
        return {**result, 'intent':intent, 'confidence':confidence, 'parameter':parameter}
