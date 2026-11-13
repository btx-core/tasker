Login gagal saat SSO aktif. **Kritis**, lihat [runbook](https://contoh.id/runbook) dan `config.yaml`.

## Langkah reproduksi

1. Buka halaman login
2. Aktifkan SSO
  - Lewat `admin`

```bash
curl -X POST /auth/sso -d '{"ok":false}'
```

---
