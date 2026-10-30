import { Workbook } from 'exceljs';
import { readSheets } from './bq.service';
import { parseBq } from './projects.util';

describe('reading a BQ workbook', () => {
  it('reads an .xlsx with formulas across sheets', async () => {
    const wb = new Workbook();
    wb.addWorksheet('Cover').addRow(['Proposed classrooms']);
    const ws = wb.addWorksheet('Bill 2');
    ws.addRow(['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']);
    ws.addRow([null, 'SUBSTRUCTURE']);
    ws.addRow(['A', 'Excavate', 'm³', 40, 650, { formula: 'D3*E3', result: 26000 }]);
    ws.addRow(['B', { richText: [{ text: 'Hardcore ' }, { text: 'filling' }] }, 'm²', 120, 400, 48000]);
    const sheets = await readSheets('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'bq.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    const r = parseBq(sheets);
    expect(r.errors).toEqual([]);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].items.map((i) => i.description)).toEqual(['Excavate', 'Hardcore filling']);
    expect(r.total).toBe(74000);
  });

  it('reads CSV and refuses old .xls files', async () => {
    const csv = await readSheets('text/csv', 'bq.csv', Buffer.from('﻿Description,Unit,Qty,Rate\nPaint,m2,10,250\n'));
    expect(parseBq(csv).total).toBe(2500);
    await expect(readSheets('application/vnd.ms-excel', 'bq.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toThrow('.xlsx');
  });
});
