from app.analytics import response_projection,credibility_score,entity_extract
from app.document_processing import detect_redactions
def test_projection():
 assert response_projection([{"completed":True,"on_time":True},{"completed":True,"on_time":False}])["on_time_rate"]==0.5
def test_credibility(): assert credibility_score([{"accurate":True},{"accurate":False}])==50
def test_redaction_detection(): assert detect_redactions("a [REDACTED] b")[0]["token"]=="[REDACTED]"
def test_entities(): assert "alice@example.com" in entity_extract("Contact Alice Smith at alice@example.com")["emails"]
