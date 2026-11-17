import { schoolNameKey } from './school-auth.service';

describe('schoolNameKey', () => {
  it('treats spelling, punctuation and short forms as the same school', () => {
    const key = schoolNameKey('St. Mary’s Girls Sec. Sch.');
    expect(schoolNameKey("st marys girls secondary school")).toBe(key);
    expect(schoolNameKey('  ST MARYS  GIRLS SECONDARY SCHOOL ')).toBe(key);
    expect(schoolNameKey('Saint Marys Girls Secondary School')).toBe(key);
    expect(schoolNameKey('The Kisumu Boys High School')).toBe(schoolNameKey('Kisumu Boys HS'));
    expect(schoolNameKey('Kisumu Girls')).toBe(schoolNameKey('Kisumu Girls Sch.'));
    expect(schoolNameKey('Kisumu Boys High')).toBe(schoolNameKey('Kisumu Boys High School'));
    expect(schoolNameKey('Ng’iya Girls & Boys Pri')).toBe(schoolNameKey("Ngiya Girls and Boys Primary"));
  });

  it('keeps different schools apart', () => {
    expect(schoolNameKey('Kisumu Girls High School')).not.toBe(schoolNameKey('Kisumu Boys High School'));
    expect(schoolNameKey('Maseno School')).not.toBe(schoolNameKey('Maseno Primary School'));
  });
});
