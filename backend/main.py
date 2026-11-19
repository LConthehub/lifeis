"""
Life Is: the program. Logins and the kitchen, on an encrypted database, on your own computer.

Everything under /api needs a session, except the few PUBLIC_PATHS. The first account made is the admin.
"""

import os
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import auth
import dbfile as sqlite3
import kitchen
import migrations
import vault
import webpages

app = FastAPI(title="Life Is", docs_url=None, redoc_url=None, openapi_url=None)

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "lifeis.db")


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=5)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def db_conn():
    db = get_db()
    try:
        yield db
    finally:
        db.close()


DbDep = Annotated[sqlite3.Connection, Depends(db_conn)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_db():
    migrations.run(DB_PATH)
    conn = get_db()
    try:
        vault.seal_existing(conn)
        conn.commit()
    finally:
        conn.close()


# ==================== THE FRONT DOOR ====================

PUBLIC_PATHS = {"/api/health", "/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/logout"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
                    "Cache-Control": "no-store"}


def is_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() == "https"


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path.rstrip("/") or "/"
    if path.startswith("/api") and path not in PUBLIC_PATHS:
        db = get_db()
        try:
            user = auth.user_for_token(db, request.cookies.get(auth.SESSION_COOKIE), touch=request.headers.get("x-background") != "1")
        finally:
            db.close()
        if not user:
            return JSONResponse({"detail": "Not logged in"}, status_code=401)
        request.state.user = user
    return await call_next(request)


@app.middleware("http")
async def security_guard(request: Request, call_next):
    """Refuses changes to /api that another website started, and keeps answers from being cached or framed."""
    if request.url.path.startswith("/api") and request.method not in SAFE_METHODS:
        if request.headers.get("sec-fetch-site") in ("cross-site", "same-site"):
            return JSONResponse({"detail": "Request blocked: it came from another website"}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if is_https(request):
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response


class Credentials(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


def _set_cookie(response: Response, token: str, request: Request):
    response.set_cookie(auth.SESSION_COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax",
                        secure=is_https(request), path="/")


def _sign_in(db, user_id: int, request: Request, response: Response):
    token = auth.create_session(db, user_id, method="password", ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    _set_cookie(response, token, request)


def _check_new(username: str, password: str):
    if not (2 <= len(username) <= 50) or not username.replace("_", "").replace(".", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Username must be 2–50 letters, numbers, dots, dashes or underscores")
    if len(password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {auth.MIN_PASSWORD_LENGTH} characters")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(request: Request, db: DbDep):
    return {"setup_required": db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0,
            "user": auth.user_for_token(db, request.cookies.get(auth.SESSION_COOKIE), touch=False)}


@app.post("/api/auth/setup", status_code=201)
def auth_setup(creds: Credentials, request: Request, response: Response, db: DbDep):
    """Make the first (admin) account. Only works while there are none."""
    username = creds.username.strip().lower()
    _check_new(username, creds.password)
    db.execute("BEGIN IMMEDIATE")
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
        db.rollback()
        raise HTTPException(status_code=403, detail="Setup has already been done")
    cur = db.execute("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)",
                     (username, auth.hash_password(creds.password), now_iso()))
    db.commit()
    _sign_in(db, cur.lastrowid, request, response)
    return {"id": cur.lastrowid, "username": username, "is_admin": True}


@app.post("/api/auth/login")
def auth_login(creds: Credentials, request: Request, response: Response, db: DbDep):
    username = creds.username.strip().lower()
    ip = client_ip(request)
    pair = f"{username}|{ip}"
    wait = max(auth.pair_throttle.seconds_locked(pair), auth.ip_throttle.seconds_locked(ip), auth.throttle.seconds_locked(username))
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {wait} seconds.")
    user = auth.check_login(db, username, creds.password)
    if not user:
        auth.pair_throttle.failure(pair)
        auth.ip_throttle.failure(ip)
        auth.throttle.failure(username)
        raise HTTPException(status_code=401, detail="Wrong username or password")
    for t, key in ((auth.pair_throttle, pair), (auth.ip_throttle, ip), (auth.throttle, username)):
        t.success(key)
    _sign_in(db, user["id"], request, response)
    return {"id": user["id"], "username": user["username"], "is_admin": bool(user["is_admin"])}


@app.post("/api/auth/logout", status_code=204)
def auth_logout(request: Request, response: Response, db: DbDep):
    auth.delete_session(db, request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")


@app.post("/api/auth/change-password", status_code=204)
def change_password(body: PasswordChange, request: Request, db: DbDep):
    user = request.state.user
    if len(body.new_password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {auth.MIN_PASSWORD_LENGTH} characters")
    found = auth.check_login(db, user["username"], body.current_password)
    if not found or found["id"] != user["id"]:
        raise HTTPException(status_code=400, detail="Current password is wrong")
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (auth.hash_password(body.new_password), user["id"]))
    db.commit()
    auth.delete_user_sessions(db, user["id"], keep_token=request.cookies.get(auth.SESSION_COOKIE))


class NewUser(BaseModel):
    username: str
    password: str


@app.post("/api/users", status_code=201)
def create_user(body: NewUser, request: Request, db: DbDep):
    """An admin adds someone else in the household, with their own kitchen."""
    if not request.state.user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only the admin can add people")
    username = body.username.strip().lower()
    _check_new(username, body.password)
    if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        raise HTTPException(status_code=409, detail="That username is taken")
    cur = db.execute("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)",
                     (username, auth.hash_password(body.password), now_iso()))
    db.commit()
    return {"id": cur.lastrowid, "username": username, "is_admin": False}


class IdleIn(BaseModel):
    idle_minutes: int


@app.get("/api/account")
def account(request: Request, db: DbDep):
    return {"idle_minutes": auth.idle_minutes_for(db, request.state.user["id"]), "idle_choices": list(auth.IDLE_CHOICES)}


@app.put("/api/account")
def save_account(body: IdleIn, request: Request, db: DbDep):
    if body.idle_minutes not in auth.IDLE_CHOICES:
        raise HTTPException(status_code=400, detail="Choose one of the offered times")
    db.execute("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'idle_minutes', ?) "
               "ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value", (request.state.user["id"], str(body.idle_minutes)))
    db.commit()
    return account(request, db)


app.include_router(kitchen.router)
auth.setup(get_db)
kitchen.setup(get_db)
init_db()

if os.environ.get("STATIC_DIR"):
    webpages.mount(app, os.environ["STATIC_DIR"])
