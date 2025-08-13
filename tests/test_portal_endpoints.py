import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from backend.web_app import app

client = TestClient(app)


def test_login_and_appointments_flow():
    res = client.post('/login', json={'username':'customer','password':'customer'})
    assert res.status_code == 200
    user = res.json()
    assert user['username'] == 'customer'
    res = client.get('/properties')
    assert res.status_code == 200
    props = res.json()
    assert isinstance(props, list) and props
    res = client.post('/appointments', json={'property_id': props[0]['id'], 'slot':'9:00 AM', 'user': user['username']})
    assert res.status_code == 200
    res = client.get('/appointments')
    assert any(a['user']=='customer' for a in res.json())


def test_availability():
    res = client.post('/availability', json={'slots':['9:00 AM']})
    assert res.status_code == 200
    res = client.get('/availability')
    assert res.json()['slots'] == ['9:00 AM']
