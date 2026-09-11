# Documento cliente de prueba

Marca ficticia **Bruma**; sin datos de clientes, cuentas reales ni inferencias pagas.

- `propuesta-bruma.pdf`: PDF real de una página, generado con ReportLab 5.0.0.
- `propuesta-bruma.png`: render de esa página con PyMuPDF 1.28.2, inspeccionado visualmente el 2026-09-11. Texto legible, acentos y ñ correctos, sin cortes ni superposiciones.
- `verification.json`: SHA-256 del PDF, cantidad de páginas y texto extraído por el parser.

El test `tests/integration/client-document.test.ts` verifica el hash de la fixture validada y recorre APIs reales de Latte sobre datos temporales: documento aprobado, listado, apertura delegada al SO (mock), vínculo, persistencia, continuación y archivo faltante. El transporte del agente es falso: no prueba inferencia real, generación por un agente ni apertura de un visor del sistema.

La suite NO requiere Python, ReportLab ni PyMuPDF. Para revalidar manualmente con PyMuPDF disponible, desde la raíz del repositorio:

```python
from pathlib import Path
import hashlib, json, pymupdf

root = Path('tests/fixtures/client-document')
pdf = root / 'propuesta-bruma.pdf'
evidence = json.loads((root / 'verification.json').read_text(encoding='utf-8'))
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == evidence['sha256']
with pymupdf.open(pdf) as doc:
    assert len(doc) == evidence['pages'] == 1
    assert ''.join(page.get_text() for page in doc) == evidence['text']
    doc[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(root / 'propuesta-bruma.png')
```

Después de cualquier cambio al PDF, volver a extraer texto, renderizar, inspeccionar toda la página y actualizar el hash. No cambiar sólo el hash para hacer pasar el test.
