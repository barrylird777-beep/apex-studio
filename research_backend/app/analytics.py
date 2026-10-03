from collections import Counter
from math import exp
def response_projection(history:list[dict])->dict:
 if not history: return {"sample_size":0,"probability":None}
 completed=sum(1 for x in history if x.get("completed"))
 on_time=sum(1 for x in history if x.get("completed") and x.get("on_time"))
 p=(on_time/completed) if completed else 0.0
 return {"sample_size":len(history),"completed":completed,"on_time":on_time,"on_time_rate":round(p,4)}
def credibility_score(tips:list[dict])->int:
 if not tips:return 0
 accurate=sum(1 for x in tips if x.get("accurate"))
 return round(100*accurate/len(tips))
def entity_extract(text:str)->dict:
 import re
 return {"emails":sorted(set(re.findall(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",text))),"capitalized_phrases":sorted(set(re.findall(r"\b(?:[A-Z][a-z]+\s+){1,3}[A-Z][a-z]+\b",text)))}
