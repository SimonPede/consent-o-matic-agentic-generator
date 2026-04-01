from pydantic import BaseModel, Field
from typing import List, Optional, Union

class Method(BaseModel):
    method_name: str
    params: dict

class Action(BaseModel):
    action_type: str
    methods: List[Method]

class CoMRuleset(BaseModel):
    rule_name: str = Field(description="Name of the rule/CMP")
    detectors: List[dict]
    actions: List[Action]