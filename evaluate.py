"""Evaluate saved webcam captures using take 0 for training, take 1 for testing.

Usage: python evaluate.py path/to/air-canvas-gestures.json
This measures repeat-take performance for one user, not unseen-user accuracy.
"""
import argparse
import json
from pathlib import Path
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from ml_models import GestureModel, LABELS, ALGORITHMS


def evaluate(train, test, algorithm):
    """Fit preprocessing and model on take 0 only, then score untouched take 1."""
    model=GestureModel(train, algorithm=algorithm)
    actual=[sample['label'] for sample in test]
    predicted=[model.predict(sample['landmarks'])['gesture'] for sample in test]
    return {'algorithm':algorithm,'algorithm_name':ALGORITHMS[algorithm],
            'accuracy':float(accuracy_score(actual,predicted)),
            'classification_report':classification_report(actual,predicted,labels=LABELS,output_dict=True,zero_division=0),
            'confusion_matrix':confusion_matrix(actual,predicted,labels=LABELS).tolist()}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset',type=Path)
    parser.add_argument('--output',type=Path,default=Path('artifacts/evaluation.json'))
    parser.add_argument('--algorithm',choices=['all',*ALGORITHMS],default='all')
    args=parser.parse_args()
    samples=json.loads(args.dataset.read_text(encoding='utf-8'))['samples']
    train=[s for s in samples if s.get('take')==0]
    test=[s for s in samples if s.get('take')==1]
    if any(sum(s['label']==label for s in test)<15 for label in LABELS):
        parser.error('Record a second take with at least 15 samples of every pose.')
    algorithms=list(ALGORITHMS) if args.algorithm=='all' else [args.algorithm]
    try:
        results={algorithm:evaluate(train,test,algorithm) for algorithm in algorithms}
    except ValueError as error:
        parser.error(str(error))
    report={'protocol':'Train take 0, test take 1. Same user; adjacent frames remain correlated.',
            'training_samples':len(train),'test_samples':len(test),'labels':LABELS,
            'results':results,
            'confidence_note':'Scores measure top-label predictions after input-range rejection; live temporal/confidence gating is not evaluated.'}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
    print('Report saved:',args.output)


if __name__=='__main__':main()
