import {
  cleanFileName,
  looksLikePdf,
  cleanItems,
  closingDateProblem,
  isOpenAdvert,
  matchesSearch,
  pinProblem,
} from './tender-advert.util';

describe('pinProblem', () => {
  it('accepts 4-6 digits that are not obvious', () => {
    expect(pinProblem('7391')).toBeNull();
    expect(pinProblem('820416')).toBeNull();
  });
  it('refuses the wrong shape and the obvious', () => {
    expect(pinProblem('12')).toContain('4 to 6 digits');
    expect(pinProblem('abcd')).toContain('4 to 6 digits');
    expect(pinProblem('0000')).toContain('harder');
    expect(pinProblem('1234')).toContain('harder');
    expect(pinProblem('111111')).toContain('harder');
  });
});

describe('closingDateProblem', () => {
  it('must be after today and within 180 days', () => {
    expect(closingDateProblem('2026-11-02', '2026-11-02')).toContain('after today');
    expect(closingDateProblem('2026-11-01', '2026-11-02')).toContain('after today');
    expect(closingDateProblem('2026-11-03', '2026-11-02')).toBeNull();
    expect(closingDateProblem('2027-05-01', '2026-11-02')).toBeNull();
    expect(closingDateProblem('2027-06-01', '2026-11-02')).toContain('180 days');
  });
});

describe('cleanItems', () => {
  it('drops empty ones, trims, and keeps a quantity only when it is positive', () => {
    expect(
      cleanItems([
        { description: '  Exercise books  ', quantity: 500, unit: ' pcs ' },
        { description: '   ' },
        { description: 'Chalk', quantity: 0, unit: '' },
      ]),
    ).toEqual([
      { description: 'Exercise books', quantity: 500, unit: 'pcs' },
      { description: 'Chalk', quantity: null, unit: null },
    ]);
  });
});

describe('looksLikePdf', () => {
  it('accepts a PDF and refuses anything else', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj'))).toBe(true);
    expect(looksLikePdf(Buffer.from('<html>not a pdf at all</html>'))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PDF'))).toBe(false);
    expect(looksLikePdf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('cleanFileName', () => {
  it('keeps a plain name, drops folders and odd characters, and ends in .pdf', () => {
    expect(cleanFileName('Tender Notice (Term 1).pdf')).toBe('Tender Notice (Term 1).pdf');
    expect(cleanFileName('C:\\Users\\school\\tender.PDF')).toBe('tender.PDF');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd.pdf');
    expect(cleanFileName('bad<script>.pdf')).toBe('badscript.pdf');
    expect(cleanFileName(undefined)).toBe('tender-document.pdf');
    expect(cleanFileName('   ')).toBe('tender-document.pdf');
  });
});

describe('isOpenAdvert', () => {
  it('is open until its closing day is over, and only if not withdrawn or removed', () => {
    expect(isOpenAdvert({ status: 'OPEN', closingDate: '2026-11-05' }, '2026-11-05')).toBe(true);
    expect(isOpenAdvert({ status: 'OPEN', closingDate: '2026-11-04' }, '2026-11-05')).toBe(false);
    expect(isOpenAdvert({ status: 'CANCELLED', closingDate: '2026-12-01' }, '2026-11-05')).toBe(false);
    expect(isOpenAdvert({ status: 'REMOVED', closingDate: '2026-12-01' }, '2026-11-05')).toBe(false);
  });
});

describe('matchesSearch', () => {
  const ad = {
    title: 'Supply of stationery',
    description: 'Term 1 supplies',
    county: 'Kisumu',
    schoolName: 'Lakeview Primary',
    items: [{ description: 'Exercise books', quantity: 500, unit: 'pcs' }],
  };
  it('finds words anywhere, all of them', () => {
    expect(matchesSearch(ad, '')).toBe(true);
    expect(matchesSearch(ad, 'kisumu books')).toBe(true);
    expect(matchesSearch(ad, 'lakeview')).toBe(true);
    expect(matchesSearch(ad, 'kisumu laptops')).toBe(false);
  });
});
