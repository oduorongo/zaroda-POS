import { BadRequestException } from '@nestjs/common';
import { signInUrl, trainingEmail, TRAINING_EMAIL_DOMAIN } from './training-accounts.service';
import { TRAINING_KITS, TRAINING_TYPES } from './training-kits';
import { TrainingTypePipe } from './training-type.pipe';

describe('training accounts', () => {
  it('covers each offered business type once (pharmacy hidden)', () => {
    expect(TRAINING_TYPES).toEqual(['RETAIL', 'RESTAURANT','SALON', 'HOTEL', 'SCHOOL_SUPPLIER', 'RENTAL', 'CONSTRUCTION']);
  });

  it('gives each kit products with a price above cost and customers', () => {
    for (const kit of TRAINING_KITS) {
      expect(kit.products.length).toBeGreaterThan(5);
      expect(kit.customers.length).toBeGreaterThan(2);
      for (const p of kit.products) expect(p.price).toBeGreaterThan(p.cost);
    }
  });

  it('makes a stable, per-team login email on the training domain', () => {
    const team = '1a0615c2-0000-4000-8000-000000000000';
    expect(trainingEmail(team, 'SCHOOL_SUPPLIER')).toBe(`school-supplier.1a0615@${TRAINING_EMAIL_DOMAIN}`);
    expect(trainingEmail(team, 'RETAIL')).not.toBe(trainingEmail('9b2c4d00-0000-4000-8000-000000000000', 'RETAIL'));
  });

  describe('sign-in address', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('sends construction to its own site and the rest to the back office', () => {
      process.env.BACKOFFICE_BASE_URL = 'https://app.example.test/';
      process.env.CONSTRUCTION_DOMAIN = 'build.example.test';
      delete process.env.RENTALS_DOMAIN;
      expect(signInUrl('CONSTRUCTION')).toBe('https://build.example.test/login');
      expect(signInUrl('RENTAL')).toBe('https://app.example.test/login');
      expect(signInUrl('RETAIL')).toBe('https://app.example.test/login');
    });

    it('is empty when no address is configured', () => {
      delete process.env.BACKOFFICE_BASE_URL;
      delete process.env.CONSTRUCTION_DOMAIN;
      delete process.env.RENTALS_DOMAIN;
      expect(signInUrl('RETAIL')).toBeNull();
    });
  });

  it('accepts only known business types in the address', () => {
    const pipe = new TrainingTypePipe();
    expect(pipe.transform('retail')).toBe('RETAIL');
    expect(() => pipe.transform('CASINO')).toThrow(BadRequestException);
  });
});
