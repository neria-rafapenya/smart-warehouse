class DomainError(Exception):
    """Base error for expected business failures."""


class OrderNotFoundError(DomainError):
    pass
