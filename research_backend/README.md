# APEX Research & FOIA Backend

Independent FastAPI/PostgreSQL/Redis research subsystem for Apex Studio.

Core modules include agencies, FOIA requests, document/OCR processing, source management with encrypted contact fields, investigations, audit records, connectors, deadline tracking, request templates, Elasticsearch indexing, and scheduled monitoring.

Start:
1. Copy research_backend/.env.example to research_backend/.env.
2. Supply secrets only through environment variables.
3. docker compose -f docker-compose.research.yml up --build.
4. docker compose -f docker-compose.research.yml exec research-api alembic upgrade head.
5. Bootstrap an administrator with APEX_ADMIN_EMAIL and APEX_ADMIN_PASSWORD.

The subsystem remains separate from the existing Node/Express creative and OMNI runtime.