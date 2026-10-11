UPDATE offline_keys
SET bound_fp = NULL
WHERE id = 13
  AND bound_fp = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

UPDATE offline_key_seats
SET is_blocked = true,
    hostname = 'служебная проверка (не ПК клиента)'
WHERE offline_key_id = 13
  AND fingerprint = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

UPDATE license_events
SET event_type = 'service_note',
    detail = 'Служебная проверка связи с сервером (key_id=13), привязка отменена'
WHERE id = 5625 AND event_type = 'offline_key_autobound';
