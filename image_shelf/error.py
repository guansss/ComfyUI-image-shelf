ERROR_INVALID_DIR = "INVALID_DIR"
ERROR_NOT_RECOGNIZED = "NOT_RECOGNIZED"


class CustomError(Exception):
    def __init__(self, error_code: str, message: str):
        super().__init__(message)
        self.error_code = error_code

    def __str__(self) -> str:
        return f"[{self.error_code}] {super().__str__()}"


class NotRecognizedError(CustomError):
    def __init__(self, message: str):
        super().__init__(ERROR_NOT_RECOGNIZED, message)
