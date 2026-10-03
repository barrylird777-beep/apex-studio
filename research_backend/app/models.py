from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Table, Column, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

investigation_sources=Table("investigation_sources",Base.metadata,
 Column("investigation_id",ForeignKey("investigations.id",ondelete="CASCADE"),primary_key=True),
 Column("source_id",ForeignKey("sources.id",ondelete="CASCADE"),primary_key=True))
investigation_documents=Table("investigation_documents",Base.metadata,
 Column("investigation_id",ForeignKey("investigations.id",ondelete="CASCADE"),primary_key=True),
 Column("document_id",ForeignKey("documents.id",ondelete="CASCADE"),primary_key=True))
investigation_requests=Table("investigation_requests",Base.metadata,
 Column("investigation_id",ForeignKey("investigations.id",ondelete="CASCADE"),primary_key=True),
 Column("request_id",ForeignKey("foia_requests.id",ondelete="CASCADE"),primary_key=True))

class Agency(Base):
 __tablename__="agencies"
 id:Mapped[int]=mapped_column(primary_key=True)
 name:Mapped[str]=mapped_column(String(300),unique=True,index=True)
 foia_portal_url:Mapped[str|None]=mapped_column(String(1000))
 contact_email:Mapped[str|None]=mapped_column(String(320))
 average_response_days:Mapped[int|None]=mapped_column(Integer)
 exemption_categories:Mapped[list|None]=mapped_column(ARRAY(String))

class User(Base):
 __tablename__="users"
 id:Mapped[int]=mapped_column(primary_key=True)
 email:Mapped[str]=mapped_column(String(320),unique=True,index=True)
 password_hash:Mapped[str]=mapped_column(String(255))
 role:Mapped[str]=mapped_column(String(30),default="researcher")
 institutional_affiliation:Mapped[str|None]=mapped_column(String(300))
 is_active:Mapped[bool]=mapped_column(Boolean,default=True)

class FoiaRequest(Base):
 __tablename__="foia_requests"
 id:Mapped[int]=mapped_column(primary_key=True)
 tracking_number:Mapped[str|None]=mapped_column(String(120),unique=True,index=True)
 agency_id:Mapped[int]=mapped_column(ForeignKey("agencies.id",ondelete="RESTRICT"),index=True)
 request_text:Mapped[str]=mapped_column(Text)
 status:Mapped[str]=mapped_column(String(40),default="pending",index=True)
 date_submitted:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
 date_due:Mapped[datetime|None]=mapped_column(DateTime(timezone=True),index=True)
 date_completed:Mapped[datetime|None]=mapped_column(DateTime(timezone=True))
 appeal_status:Mapped[str|None]=mapped_column(String(40))
 agency:Mapped[Agency]=relationship()

class Document(Base):
 __tablename__="documents"
 id:Mapped[int]=mapped_column(primary_key=True)
 request_id:Mapped[int|None]=mapped_column(ForeignKey("foia_requests.id",ondelete="SET NULL"),index=True)
 file_path:Mapped[str|None]=mapped_column(String(1500))
 file_hash:Mapped[str]=mapped_column(String(128),unique=True,index=True)
 source_url:Mapped[str|None]=mapped_column(String(2000))
 classification_level:Mapped[str]=mapped_column(String(40),default="public")
 redaction_count:Mapped[int]=mapped_column(Integer,default=0)
 ocr_text:Mapped[str|None]=mapped_column(Text)

class Source(Base):
 __tablename__="sources"
 id:Mapped[int]=mapped_column(primary_key=True)
 name:Mapped[str]=mapped_column(String(300),index=True)
 type:Mapped[str]=mapped_column(String(30))
 encrypted_contact_info:Mapped[str|None]=mapped_column(Text)
 reliability_rating:Mapped[int|None]=mapped_column(Integer)
 relationship_notes:Mapped[str|None]=mapped_column(Text)

class Investigation(Base):
 __tablename__="investigations"
 id:Mapped[int]=mapped_column(primary_key=True)
 title:Mapped[str]=mapped_column(String(500),index=True)
 description:Mapped[str|None]=mapped_column(Text)
 status:Mapped[str]=mapped_column(String(40),default="active",index=True)
 requests=relationship("FoiaRequest",secondary=investigation_requests)
 sources=relationship("Source",secondary=investigation_sources)
 documents=relationship("Document",secondary=investigation_documents)

class AuditLog(Base):
 __tablename__="audit_logs"
 id:Mapped[int]=mapped_column(primary_key=True)
 actor_user_id:Mapped[int|None]=mapped_column(ForeignKey("users.id",ondelete="SET NULL"))
 action:Mapped[str]=mapped_column(String(120),index=True)
 object_type:Mapped[str]=mapped_column(String(80))
 object_id:Mapped[str]=mapped_column(String(120))
 metadata_json:Mapped[dict|None]=mapped_column(JSONB)
 created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=datetime.utcnow,index=True)
