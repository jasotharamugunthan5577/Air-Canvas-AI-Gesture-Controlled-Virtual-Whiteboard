"""Double-click launcher: an owned Python backend and a native desktop window."""
from pathlib import Path
import ctypes
import logging
import socket
import sys
import threading
import time

ROOT = Path(__file__).resolve().parent


def main():
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    logging.basicConfig(filename=ROOT/'artifacts/desktop.log', level=logging.INFO)
    server = None
    worker = None
    listener = None
    try:
        import uvicorn
        import webview
        from main import app, BUILD_ID

        # A stable private origin keeps the desktop's calibration and board saved.
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if sys.platform == 'win32':
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(('127.0.0.1', 8765))
        except OSError as error:
            raise RuntimeError('Air Canvas may already be open. Close its existing window and try again. '
                               'The desktop port 8765 must be available.') from error
        listener.listen(128)
        server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False))
        worker = threading.Thread(target=server.run, kwargs={'sockets':[listener]}, daemon=True)
        worker.start()
        deadline = time.monotonic()+15
        while not server.started:
            if not worker.is_alive() or time.monotonic()>deadline:
                raise RuntimeError('The Python service could not start. See artifacts/desktop.log.')
            time.sleep(.05)
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.create_window('Air Canvas AI — SVM + Random Forest',
                              f'http://127.0.0.1:8765/?v={BUILD_ID}', width=1320, height=900,
                              min_size=(800,600), background_color='#f5f6fa')
        webview.start(gui='edgechromium', private_mode=False, storage_path=str(ROOT/'.desktop-profile'))
    except Exception as error:
        logging.exception('Desktop startup failed')
        ctypes.windll.user32.MessageBoxW(0, f'Could not open Air Canvas.\n\n{error}\n\n'
            'Setup: .venv\\Scripts\\python -m pip install -r requirements.txt\n'
            'Microsoft Edge WebView2 Runtime is also required.', 'Air Canvas AI', 0x10)
    finally:
        if server:
            server.should_exit=True
        if worker:
            worker.join(timeout=5)
        if listener:
            listener.close()


if __name__ == '__main__':
    main()
