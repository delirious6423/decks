"""Where StrategyU Decks keeps your decks, and which port it serves them on.

Settings come from, in order (later wins):

  1. defaults: port 8790, host 127.0.0.1, decks in ~/slide-decks
  2. config.json next to this file, or the file named by SB_CONFIG
  3. environment: SB_PORT, SB_HOST, SB_DECKS_DIR

    { "port": 8790, "host": "127.0.0.1", "decks_dir": "~/slide-decks" }

The deck registry (decks.json) and settings.json live in the decks folder, next to
the decks themselves, so the app folder never holds your work. Command line tools
(sb, tools/browser.mjs) find the server at SB_URL, or at http://localhost:<port>.
"""
import json
import os
from pathlib import Path

APP = Path(__file__).resolve().parent
DEFAULTS = {'port': 8790, 'host': '127.0.0.1', 'decks_dir': '~/slide-decks'}
ENV = {'port': 'SB_PORT', 'host': 'SB_HOST', 'decks_dir': 'SB_DECKS_DIR'}


def load():
    cfg = dict(DEFAULTS)
    path = Path(os.environ.get('SB_CONFIG') or APP / 'config.json').expanduser()
    if path.is_file():
        with open(path, encoding='utf-8') as f:
            cfg.update({k: v for k, v in json.load(f).items() if k in DEFAULTS and v not in (None, '')})
    for key, var in ENV.items():
        if os.environ.get(var):
            cfg[key] = os.environ[var]
    cfg['port'] = int(cfg['port'])
    cfg['decks_dir'] = Path(os.path.expanduser(str(cfg['decks_dir']))).resolve()
    return cfg


CONFIG = load()
PORT = CONFIG['port']          # the server sets this to the port it actually listens on
HOST = CONFIG['host']
DECKS = CONFIG['decks_dir']
REGISTRY = DECKS / 'decks.json'
SETTINGS = DECKS / 'settings.json'


def url():
    return (os.environ.get('SB_URL') or f'http://localhost:{PORT}').rstrip('/')


def tilde(path):
    """A path as written in decks.json: ~/... under the home folder, absolute otherwise."""
    path = Path(path).resolve()
    try:
        return '~/' + str(path.relative_to(Path.home()))
    except ValueError:
        return str(path)
