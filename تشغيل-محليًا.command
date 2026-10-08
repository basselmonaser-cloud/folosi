#!/bin/bash
# يشغّل فلوسي 3.0.2 للتجربة على هذا الماك فقط: http://localhost:8767 (بيانات منفصلة عن أي نسخة أخرى)
cd "$(dirname "$0")/التطبيق" || exit 1
echo "فلوسي 3.0.2 يعمل على http://localhost:8767 — أغلق هذه النافذة لإيقافه"
exec python3 -m http.server 8767 --bind 127.0.0.1
