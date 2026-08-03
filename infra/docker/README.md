# Local dev environment

From the repo root:
```bash
docker compose -f infra/docker/docker-compose.yml up
```

This starts:
- Postgres on :5432
- MinIO on :9000 (API) and :9001 (web console — login minioadmin/minioadmin)
- FastAPI backend on :4005

Run the frontend separately (not containerized yet, for fast dev reload):
```bash
cd apps/web
npm install
npm run dev
```
Then visit http://localhost:5173
