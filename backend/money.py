"""Money utilities. All monetary values are stored as integer cents to avoid
floating-point rounding errors. Conversions use Decimal with ROUND_HALF_UP.

Rounding rule: EUR, 2 decimal places, half-up (0.005 -> 0.01).
"""
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("1")
TWOPLACES = Decimal("0.01")


def to_cents(euros) -> int:
    """Convert a euro amount (number or string) to integer cents, half-up."""
    if euros is None:
        return 0
    d = Decimal(str(euros)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    return int((d * 100).to_integral_value(rounding=ROUND_HALF_UP))


def from_cents(cents) -> float:
    """Convert integer cents to a float euro amount with 2 decimals."""
    return float((Decimal(int(cents or 0)) / 100).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def permillage_cents(total_cents: int, permillage) -> int:
    """Share of a total based on permillage (‰). Half-up to the cent."""
    d = (Decimal(int(total_cents)) * Decimal(str(permillage)) / Decimal(1000))
    return int(d.to_integral_value(rounding=ROUND_HALF_UP))


def split_periods(annual_cents: int, n_periods: int):
    """Split an annual amount into n periods without losing cents.
    The remainder is added to the first period."""
    if n_periods <= 0:
        return []
    base = annual_cents // n_periods
    remainder = annual_cents - base * n_periods
    return [base + (remainder if i == 0 else 0) for i in range(n_periods)]
