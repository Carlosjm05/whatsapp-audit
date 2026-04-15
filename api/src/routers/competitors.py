"""Panel 6: Competitor intelligence."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import fetch_all
from ..schemas import CompetitorsResponse

router = APIRouter(prefix="/api/competitors", tags=["competitors"])


@router.get("", response_model=CompetitorsResponse)
def competitors_overview(_user: str = Depends(get_current_user)) -> CompetitorsResponse:
    top_competitors = fetch_all(
        """
        SELECT competitor_name,
               COUNT(*)::int AS mentions,
               COUNT(*) FILTER (WHERE went_with_competitor = TRUE)::int AS lost_to_competitor
          FROM competitor_intel
         WHERE competitor_name IS NOT NULL AND competitor_name <> ''
         GROUP BY competitor_name
         ORDER BY mentions DESC
         LIMIT 25
        """
    )

    top_reasons_considering = fetch_all(
        """
        SELECT why_considering AS reason, COUNT(*)::int AS count
          FROM competitor_intel
         WHERE why_considering IS NOT NULL AND why_considering <> ''
         GROUP BY why_considering
         ORDER BY count DESC
         LIMIT 20
        """
    )

    loss_reasons = fetch_all(
        """
        SELECT COALESCE(co.loss_reason, 'sin_dato') AS loss_reason, COUNT(*)::int AS count
          FROM conversation_outcomes co
          JOIN competitor_intel ci ON ci.lead_id = co.lead_id
         WHERE ci.went_with_competitor = TRUE
         GROUP BY co.loss_reason
         ORDER BY count DESC
         LIMIT 20
        """
    )

    return CompetitorsResponse(
        top_competitors=top_competitors,
        top_reasons_considering=top_reasons_considering,
        loss_reasons=loss_reasons,
    )
