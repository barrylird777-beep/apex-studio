from sqlalchemy.ext.asyncio import AsyncSession
from .models import AuditLog
async def record_access(db:AsyncSession,actor_user_id:int|None,action:str,object_type:str,object_id:str,metadata:dict|None=None):
 db.add(AuditLog(actor_user_id=actor_user_id,action=action,object_type=object_type,object_id=str(object_id),metadata_json=metadata)); await db.commit()
