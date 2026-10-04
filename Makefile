# Developer entry points. `make check` is what CI runs.
.PHONY: check test typecheck build start stop status

check: test typecheck build

backend/.venv/bin/pytest:
	python3 -m venv backend/.venv
	backend/.venv/bin/pip install --quiet -r backend/requirements-dev.txt

frontend/node_modules/.bin/vite:
	cd frontend && npm ci --no-audit --no-fund

test: backend/.venv/bin/pytest
	cd backend && .venv/bin/python -m pytest -q

typecheck: frontend/node_modules/.bin/vite
	cd frontend && npx tsc --noEmit

build: frontend/node_modules/.bin/vite
	cd frontend && npx vite build

start:
	./start.sh

stop:
	./start.sh stop

status:
	./start.sh status
