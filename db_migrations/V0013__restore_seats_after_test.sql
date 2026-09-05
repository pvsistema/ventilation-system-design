-- Возврат боевых значений после проверки ограничения по числу компьютеров.
-- Лимит ключа «ООО Якутское Золото» восстанавливаем как было (999).
UPDATE offline_keys SET seats = 999 WHERE id = 1;

-- Тестовые рабочие места, созданные при проверке, помечаем отключёнными,
-- чтобы они не занимали места и не путались в реестре (удаление запрещено).
UPDATE offline_key_seats
SET is_blocked = TRUE,
    hostname = '[тестовая запись]'
WHERE fingerprint IN (
    '71bd8c3c0ba4c31a9f0eb59aa25c8ee1a6c0d2f9f80b5a2f1e2a5c0d3b7e4f11'
) OR hostname IN ('TestPC', 'TestPC-2', 'PC-A', 'PC-Levak');