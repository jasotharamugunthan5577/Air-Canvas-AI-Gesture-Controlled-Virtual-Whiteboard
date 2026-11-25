# Air Canvas AI

A Python gesture whiteboard using **scikit-learn SVM and Random Forest**.
All model fitting, scaling, text vectorization and evaluation metrics use library
implementations. Hand landmark geometry and application controls are ordinary
application code.

## Open the project

In File Explorer, open `E:\AirCanvas` and double-click **Open Air Canvas.cmd**.
Close any older Air Canvas window before reopening after an update. The launcher
starts Python automatically and displays a desktop window. Its private local
service runs internally; no address or terminal command needs to be entered.
The desktop requires Microsoft Edge WebView2 Runtime.

For setup on another Windows computer (Python 3.10+):

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

`requirements-lock.txt` captures the installed versions, including test utilities.
For optional browser mode, run `run.ps1`, or:

```powershell
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then open http://127.0.0.1:8000. The application is intended for local, single-user
use. Interactive API documentation is available at `/docs`.

## ML code to show your faculty

Open **ml_models.py**. Both gesture and command classifiers are in this one file.

| Purpose | Library components | Code to explain |
| --- | --- | --- |
| Gesture recognition: SVM | `Pipeline`, `StandardScaler`, `SVC` | RBF kernel, C=10, probability estimates, `.fit()` and `.predict_proba()` |
| Gesture recognition: Random Forest | `Pipeline`, `StandardScaler`, `RandomForestClassifier` | 150 trees, bootstrap samples and random feature subsets |
| Voice/typed command recognition | `Pipeline`, `TfidfVectorizer`, `RandomForestClassifier` | TF-IDF word/bigram features, 200 classification trees, labelled command corpus |
| Evaluation | `sklearn.metrics` in `evaluate.py` | Accuracy, precision, recall, F1 and confusion matrix |

SVM directly matches **Experiment 7** in the supplied PDFs. Random Forest is the
additional method requested for this project. MediaPipe detects 21 hand landmarks;
the selected Python model assigns the gesture. The optional AI tutor is a separate
vision-language service, not part of these two course classifiers.

`main.py` connects these models to the real application:
- `/api/train`: fit the selected gesture model on captured samples.
- `/api/gesture`: classify a detected hand using that trained model.
- `/api/voice`: classify a spoken or typed command with Random Forest.

## Simplified source layout

```text
AirCanvas/
  Open Air Canvas.cmd    Double-click launcher
  desktop.py             Desktop window and background server lifecycle
  main.py                Python API and tutor connection
  ml_models.py           All SVM and Random Forest ML code
  exports.py             PNG/JPG/PDF generation
  evaluate.py            Compare the two gesture classifiers
  test_project.py         Python checks
  test_engine.mjs         Drawing and gesture-state checks
  static/                Interface: HTML, CSS and JavaScript
  requirements.txt       Application dependencies
  requirements-lock.txt  Installed dependency versions
  run.ps1                Optional browser-mode launcher
  .env.example           Optional tutor configuration
```

`static` is the only application source subfolder. `.venv` contains installed
Python packages, `.desktop-profile` contains your saved desktop data, and
`artifacts` contains runtime logs/reports. These runtime directories are retained
so the installed app and saved work are preserved. Python/test tools may create
cache directories when run.

## Train gestures

1. Select **Start camera** and allow camera access.
2. Open **Train gestures** and select **SVM** or **Random Forest**.
3. Choose a pose. After a 2.5-second countdown, hold it while 20 samples are captured.
4. Capture a second take of that pose. Slightly vary position and distance between
   takes. Repeat for every pose below.
5. Click **Train SVM model** or **Train Random Forest model**.
6. Close the panel and select **Enable gestures**.
7. To compare models, change the selector and train again using the saved samples.
   Switching algorithms pauses gesture control until the new model is trained.

| Pose | Action |
| --- | --- |
| Index finger extended | Draw with the selected tool |
| Fist | Erase using the palm center |
| Open palm | Hold 1.6 seconds to request canvas clear |
| Thumb/index pinch | Open the tool menu |
| Index and middle fingers extended | Pointer without drawing |
| Thumbs up | Confirm pending clear |
| Relaxed hand | Idle |

Point at a menu control and hold for 0.9 seconds to select it. Clear supports
Confirm/Cancel and can be undone. Calibration requires at least 15 samples per pose;
two complete takes provide 40. Keep the palm facing the camera under good lighting.
Only labelled landmark coordinates are saved/sent to the local Python service;
raw video is not recorded or uploaded. Browser and desktop storage are separate.

Settings adjust confidence and pointer smoothing. SVM probabilities and forest
scores can differ; capture more varied samples if recognition is unreliable.
The basic input-range check rejects extreme landmarks, but unseen poses can still
be misclassified. Actual accuracy needs evaluation with your hand captures.
MediaPipe loads pinned JavaScript/WASM/model assets from jsDelivr and Google
Storage, so an internet connection is required for initial camera setup.

## Voice commands

Use **Start voice**, or type a command and select **Run**. Speech recognition is
provided by the browser/WebView and may use an external recognition service.
If speech recognition is unavailable, typed commands use the same Random Forest.
The app does not record microphone audio.

Examples:
- Change pen color to blue.
- Start drawing. / Use eraser.
- Increase brush thickness. / Make the brush thinner.
- Undo. / Redo.
- Clear the canvas. / Confirm. / Cancel.
- Export as PDF. / Save as PNG.
- Explain this diagram.

The training corpus is visible in `ml_models.py`. Commands with no known vocabulary
or low confidence are rejected. Negation handling and color/format extraction are
application safeguards. This small classifier does not understand arbitrary
language; use the tutor input for open-ended questions.

## Drawing and exports

The board stores normalized vector strokes and supports colors, brush width,
segment-splitting erasure, undo/redo and protected clear. History keeps up to 60
actions in memory; the latest board and settings are saved in local storage.
PNG/JPG exports are 1600 x 1000. PDF exports include a title and timestamp.
The API accepts up to 1,000 strokes and 100,000 total points per export.

Keyboard: P pen, E eraser, Ctrl/Cmd+Z undo, Ctrl+Y or Ctrl/Cmd+Shift+Z redo,
Escape close dialog/exit presentation. Pointer drawing works without a camera.

## Optional AI tutor

Install Ollama separately and download a vision-capable model:

```powershell
ollama pull gemma3:4b
ollama serve
```

Do not start a second server if Ollama is already running. Defaults are
`OLLAMA_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=gemma3:4b`. Copy `.env.example`
to `.env` to change them, then restart the app. No local Ollama API key is required.
The model download requires substantial disk/RAM; weights are not bundled.

The tutor sends the current drawing and recent chat to the configured Ollama
service. Explanation, quiz, improvement and summary controls require that service.
An unavailable tutor does not interrupt drawing. Answers may be inaccurate;
provide textual context for unclear handwriting/diagrams. Read aloud uses speech
synthesis where supported.

## Evaluate and check

Download your captured samples with **Download dataset**, then run:

```powershell
.venv\Scripts\python evaluate.py air-canvas-gestures.json
```

This compares SVM and Random Forest using take 0 for training and take 1 for
testing. Use `--algorithm svm` or `--algorithm random_forest` for one model.
Reports are written to `artifacts/evaluation.json`. Scaling is fitted only on the
training take. Takes from one person remain correlated; separate sessions/users
are needed for strong generalization evidence. The live app fits both takes.
Metrics do not include live confidence/temporal gating. No accuracy is claimed
before collecting real samples.

For automated software checks (pytest is a test-only dependency):

```powershell
.venv\Scripts\python -m pip install pytest
.venv\Scripts\python -B -m pytest -q -p no:cacheprovider test_project.py
node --test test_engine.mjs
```

Synthetic test fixtures validate the implementation, not webcam accuracy. Manually
check all gestures, camera permissions, tracking loss, menu dwell, microphone
recognition and an actual tutor response on the presentation laptop.

## Troubleshooting

- After updating code, close and reopen the desktop window. In browser mode,
  restart Python and refresh the page.
- Camera blocked: allow permission, close other camera apps, and check network
  access for the MediaPipe assets. Stop/restart after changing camera selection.
- Calibration expired after restarting Python: reload to retrain saved samples.
- Empty downloaded dataset: record both takes of all poses before evaluating.
- Desktop fails to start: inspect `artifacts/desktop.log`; check WebView2 Runtime
  and that another Air Canvas window is not already using desktop port 8765.
- Storage full: export the board before closing. Do not delete `.desktop-profile`
  if you need its saved drawing or calibration.

Future improvements: cross-user training/evaluation, packaged offline CV assets,
OCR and collaboration. Authentication and deployment hardening would be needed
before exposing this local demonstration app as a hosted service.

## Comparison dashboard
The desktop dashboard shows both scikit-learn classifiers side by side. Train gestures fits both SVM and Random Forest; the selected primary model controls drawing. Evaluation charts train on take 0 and test on take 1 before fitting the live models on all saved samples. Charts show per-class recall and row-normalized confusion matrices for all seven poses. These are same-user repeat-take results, not independent user accuracy. The AI Tutor remains available in the expandable panel below the dashboard.
