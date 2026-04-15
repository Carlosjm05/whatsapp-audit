"""Panel 4: Product intelligence aggregates."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import fetch_all
from ..schemas import ProductIntelResponse

router = APIRouter(prefix="/api/product-intel", tags=["product-intel"])


@router.get("", response_model=ProductIntelResponse)
def product_intel(_user: str = Depends(get_current_user)) -> ProductIntelResponse:
    demand_by_product_type = fetch_all(
        """
        SELECT COALESCE(product_type, 'desconocido') AS product_type, COUNT(*)::int AS count
          FROM lead_interests
         GROUP BY product_type
         ORDER BY count DESC
        """
    )

    demand_by_zone = fetch_all(
        """
        SELECT COALESCE(desired_zone, 'desconocida') AS zone, COUNT(*)::int AS count
          FROM lead_interests
         GROUP BY desired_zone
         ORDER BY count DESC
         LIMIT 50
        """
    )

    budget_range_distribution = fetch_all(
        """
        SELECT COALESCE(budget_range, 'sin_datos') AS budget_range, COUNT(*)::int AS count
          FROM lead_financials
         GROUP BY budget_range
         ORDER BY count DESC
        """
    )

    top_projects_mentioned = fetch_all(
        """
        SELECT proj AS project, COUNT(*)::int AS count
          FROM lead_interests, LATERAL unnest(COALESCE(all_projects_mentioned, ARRAY[]::text[])) AS proj
         WHERE proj IS NOT NULL AND proj <> ''
         GROUP BY proj
         ORDER BY count DESC
         LIMIT 30
        """
    )

    payment_method_distribution = fetch_all(
        """
        SELECT COALESCE(payment_method, 'sin_datos') AS payment_method, COUNT(*)::int AS count
          FROM lead_financials
         GROUP BY payment_method
         ORDER BY count DESC
        """
    )

    return ProductIntelResponse(
        demand_by_product_type=demand_by_product_type,
        demand_by_zone=demand_by_zone,
        budget_range_distribution=budget_range_distribution,
        top_projects_mentioned=top_projects_mentioned,
        payment_method_distribution=payment_method_distribution,
    )
