from pydantic import BaseModel, field_validator, RootModel
from typing import Any, Dict, List, Optional, Union

VALID_METHOD_NAMES = {"OPEN_OPTIONS", "DO_CONSENT", "SAVE_CONSENT", "HIDE_CMP"}

class DOMTarget(BaseModel):
    selector: str
    textFilter: Optional[Union[str, List[str]]] = None
    displayFilter: Optional[bool] = None
    
class Matcher(BaseModel):
    type: str
    target: Optional[DOMTarget] = None
    parent: Optional[DOMTarget] = None
    
class Detector(BaseModel):
    presentMatcher: Union[Matcher, List[Matcher]]
    showingMatcher: Union[Matcher, List[Matcher]]

class Method(BaseModel):
    name: str
    action: Dict[str, Any]
    
    @field_validator("name")
    @classmethod
    def validate_method_name(cls, name: str) -> str:
        if name not in VALID_METHOD_NAMES:
            raise ValueError(f"Invalid method name: {name}. Must be one of {VALID_METHOD_NAMES}")
        return name
    
class CMPConfig(BaseModel):
    detectors: List[Detector]
    methods: List[Method]

class CoMRule(RootModel[Dict[str, CMPConfig]]):
    pass