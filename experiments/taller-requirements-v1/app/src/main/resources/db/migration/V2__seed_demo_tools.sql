INSERT INTO tools(code,name,quantity,last_reviewed_at) VALUES
('MULT-001','Multímetro digital',4,'2026-09-19T14:15:00Z'),
('OSC-002','Osciloscopio portátil',1,NULL),
('LLAVE-003','Llave dinamométrica',6,'2026-10-01T10:00:00Z'),
('SCAN-004','Escáner automotriz',2,NULL)
ON CONFLICT (code) DO NOTHING;
