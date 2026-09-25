from app.application.validate_order import validate_order


def test_atypical_order_requires_human_review():
    result = validate_order(
        requested_qty=250,
        historical_average=24,
        available_stock=86,
        demand_qty=18,
        required_document_present=True,
    )
    assert result.risk == "red"
    assert result.status == "blocked"
    assert len(result.reasons) == 2


def test_normal_order_is_approved():
    result = validate_order(
        requested_qty=25,
        historical_average=24,
        available_stock=86,
        demand_qty=18,
        required_document_present=True,
    )
    assert result.risk == "green"
    assert result.status == "approved"
