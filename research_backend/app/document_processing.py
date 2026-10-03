from pathlib import Path
import hashlib,re
from PIL import Image
import pytesseract

def sha256_file(path:str)->str:
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
 return h.hexdigest()

def ocr_image(path:str)->str: return pytesseract.image_to_string(Image.open(path))

def detect_redactions(text:str)->list[dict]:
 return [{"start":m.start(),"end":m.end(),"token":m.group()} for m in re.finditer(r"\b(?:\[REDACTED\]|REDACTED|████+)\b",text,re.I)]

def compare_text(old:str,new:str)->dict:
 old_lines=old.splitlines(); new_lines=new.splitlines()
 return {"removed":[x for x in old_lines if x and x not in new_lines],"added":[x for x in new_lines if x and x not in old_lines],"redaction_candidates":detect_redactions(new)}
