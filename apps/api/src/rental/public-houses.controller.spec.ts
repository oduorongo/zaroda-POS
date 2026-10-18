import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { PublicHousesController } from './rental-listings.controller';
import { PublicHousesService } from './public-houses.service';

// Real HTTP requests through Nest's routing and pipes - the public page once broke because a query-string helper
// rejected requests with NO filters, which no service-level test could catch.
describe('GET /public/houses', () => {
  let app: INestApplication;
  const list = jest.fn().mockResolvedValue({ houses: [], hasMore: false });
  const get = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
      controllers: [PublicHousesController],
      providers: [{ provide: PublicHousesService, useValue: { list, get } }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => list.mockClear());

  it('works with no filters at all', async () => {
    await request(app.getHttpServer()).get('/public/houses').expect(200);
    expect(list).toHaveBeenCalledWith({ area: undefined, type: undefined, minRent: undefined, maxRent: undefined, page: undefined });
  });

  it('passes filters through as numbers', async () => {
    await request(app.getHttpServer()).get('/public/houses?area=Kasarani&type=BEDSITTER&minRent=3000&maxRent=9000&page=2').expect(200);
    expect(list).toHaveBeenCalledWith({ area: 'Kasarani', type: 'BEDSITTER', minRent: 3000, maxRent: 9000, page: 2 });
  });

  it('ignores blank or unreadable numbers instead of failing the page', async () => {
    await request(app.getHttpServer()).get('/public/houses?minRent=&maxRent=abc&page=x').expect(200);
    expect(list).toHaveBeenCalledWith({ area: undefined, type: undefined, minRent: undefined, maxRent: undefined, page: undefined });
  });

  it('rejects an advert id that is not a UUID', async () => {
    await request(app.getHttpServer()).get('/public/houses/not-a-uuid').expect(400);
  });
});
