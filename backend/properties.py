"""FastAPI router for property listing management."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

import properties_store


router = APIRouter(prefix="/properties", tags=["properties"])


class PropertyCreate(BaseModel):
    address: str
    listingNumber: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipCode: Optional[str] = None
    price: Optional[str] = None
    beds: Optional[float] = Field(None, ge=0)
    baths: Optional[float] = Field(None, ge=0)
    year: Optional[int] = Field(None, ge=0)
    status: Optional[str] = None
    type: Optional[str] = None
    saleOrRent: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None


class Property(PropertyCreate):
    id: str
    inSystem: bool = True
    removedAt: Optional[str] = None


@router.get("", response_model=list[Property])
def list_properties() -> list[dict[str, Any]]:
    """Return all property records."""

    return properties_store.list_properties()


@router.post("", response_model=Property, status_code=status.HTTP_201_CREATED)
def create_property(payload: PropertyCreate) -> Mapping[str, Any]:
    try:
        return properties_store.create_property(payload.model_dump())
    except ValueError as exc:  # validation from persistence layer
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except properties_store.IntegrityError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property already exists") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Failed to store property") from exc


@router.post("/{property_id}/remove", response_model=Property)
def remove_property(property_id: str) -> Mapping[str, Any]:
    try:
        return properties_store.set_in_system(property_id, False)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found") from exc


@router.post("/{property_id}/restore", response_model=Property)
def restore_property(property_id: str) -> Mapping[str, Any]:
    try:
        return properties_store.set_in_system(property_id, True)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found") from exc

