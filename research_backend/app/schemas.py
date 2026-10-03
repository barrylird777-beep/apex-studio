from datetime import datetime
from pydantic import BaseModel, Field

class Token(BaseModel): access_token:str; token_type:str="bearer"
class UserCreate(BaseModel):
 email:str
 password:str=Field(min_length=12)
 role:str="researcher"
 institutional_affiliation:str|None=None
class AgencyCreate(BaseModel):
 name:str
 foia_portal_url:str|None=None
 contact_email:str|None=None
 average_response_days:int|None=None
 exemption_categories:list[str]=[]
class RequestCreate(BaseModel):
 agency_id:int
 request_text:str
 tracking_number:str|None=None
 date_submitted:datetime|None=None
 date_due:datetime|None=None
class InvestigationCreate(BaseModel):
 title:str
 description:str|None=None
 status:str="active"
 request_ids:list[int]=[]
 source_ids:list[int]=[]
 document_ids:list[int]=[]
class SourceCreate(BaseModel):
 name:str
 type:str
 contact_info:str|None=None
 reliability_rating:int|None=None
 relationship_notes:str|None=None
class DocumentCreate(BaseModel):
 request_id:int|None=None
 file_path:str|None=None
 file_hash:str
 source_url:str|None=None
 classification_level:str="public"
 redaction_count:int=0
 ocr_text:str|None=None
