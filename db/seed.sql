-- ══════════════════════════════════════════════════════════════
-- SEED DATA — Catálogos iniciales
-- ══════════════════════════════════════════════════════════════
-- Se carga UNA VEZ al primer boot del volumen Postgres, tras
-- schema.sql e indexes.sql. Usa ON CONFLICT DO NOTHING para que
-- re-aplicarlo manualmente en un despliegue ya poblado sea seguro.
-- Los valores aquí pueden editarse después vía dashboard /catalogos.
-- ══════════════════════════════════════════════════════════════

-- ─── PROYECTOS ───────────────────────────────────────────────
INSERT INTO projects_catalog (canonical_name, aliases, city, is_active) VALUES
    ('Brisas del Río',
        ARRAY['brisas del rio', 'brisas'], NULL, true),
    ('Caracolí',
        ARRAY['caracoli'], NULL, true),
    ('Oasis Ecológico',
        ARRAY['oasis ecologico', 'oasis'], NULL, true),
    ('Oasis del Olimpo',
        ARRAY['olimpo', 'parcelacion olimpo', 'parcelación olimpo'], NULL, true),
    ('Jardines de Bellavista',
        ARRAY['jardines de bellavista', 'jardines bellavista'], NULL, true),
    ('Bellavista',
        ARRAY['bellavista'], NULL, true),
    ('Miramonte',
        ARRAY['miramonte'], NULL, true),
    ('Cancún',
        ARRAY['cancun'], NULL, true),
    ('Fincas de San Isidro',
        ARRAY['fincas de san isidro', 'san isidro', 'fincas san isidro'], NULL, true),
    ('Cielito Lindo',
        ARRAY['cielito lindo', 'cielito'], NULL, true),
    ('Condominio Mirador de Anapoima',
        ARRAY['condominio mirador de anapoima', 'condominio mirador anapoima',
              'mirador de anapoima', 'mirador anapoima'], 'Anapoima', true),
    ('Mirador de Anapoima campestre',
        ARRAY['mirador de anapoima campestre', 'mirador anapoima campestre'],
        'Anapoima', true),
    ('Cardón',
        ARRAY['cardon'], NULL, true)
ON CONFLICT (canonical_name) DO NOTHING;

-- ─── ASESORES ────────────────────────────────────────────────
INSERT INTO advisors_catalog (canonical_name, aliases, is_active) VALUES
    ('Ronald',    ARRAY['ronald'], true),
    ('Jhon',      ARRAY['jhon', 'john'], true),
    ('Sandra',    ARRAY['sandra'], true),
    ('Tatiana',   ARRAY['tatiana', 'tati'], true),
    ('Pilar',     ARRAY['pilar'], true),
    ('Valentina', ARRAY['valentina', 'vale'], true),
    ('Oscar',     ARRAY['oscar', 'óscar', 'daniela', 'dani'], true)
ON CONFLICT (canonical_name) DO NOTHING;
