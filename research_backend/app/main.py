from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import api
app=FastAPI(title="APEX Research & FOIA API",version="1.0.0")
app.add_middleware(CORSMiddleware,allow_origins=[x.strip() for x in settings.cors_origins.split(",")],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
app.include_router(api)
@app.get("/")
async def root(): return {"service":"APEX Research & FOIA","docs":"/docs"}
