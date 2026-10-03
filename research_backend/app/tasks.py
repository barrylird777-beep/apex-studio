from celery import Celery
from .config import settings
celery=Celery("apex_research",broker=settings.redis_url,backend=settings.redis_url)
@celery.task
def refresh_agency_metadata(): return {"scheduled":"agency-metadata-refresh"}
@celery.task
def check_foia_deadlines(): return {"scheduled":"foia-deadline-check"}
@celery.task
def process_document(document_id:int): return {"document_id":document_id,"status":"queued"}
@celery.task
def monitor_sources(): return {"scheduled":"source-monitor"}
