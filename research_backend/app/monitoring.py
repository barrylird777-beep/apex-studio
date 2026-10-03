from celery import Celery
from .config import settings
from .tasks import celery

@celery.task
def monitor_federal_register(keywords:list[str]): return {"keywords":keywords,"status":"scheduled"}

@celery.task
def monitor_reading_rooms(urls:list[str]): return {"urls":urls,"status":"scheduled"}

@celery.task
def detect_page_changes(urls:list[str]): return {"urls":urls,"status":"scheduled"}

@celery.task
def alert_document_release(investigation_id:int,keywords:list[str]): return {"investigation_id":investigation_id,"keywords":keywords,"status":"scheduled"}
