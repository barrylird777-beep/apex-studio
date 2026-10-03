from celery.schedules import crontab
from .tasks import celery
celery.conf.beat_schedule={
 "monthly-agency-refresh":{"task":"app.tasks.refresh_agency_metadata","schedule":crontab(minute=0,hour=3,day_of_month=1)},
 "daily-foia-deadlines":{"task":"app.tasks.check_foia_deadlines","schedule":crontab(minute=0,hour=8)},
 "hourly-source-monitor":{"task":"app.tasks.monitor_sources","schedule":crontab(minute=15)},
}
