import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenderBuyerStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import {
  hashPin,
  MAX_PIN_FAILURES,
  PIN_LOCK_MS,
  verifyPin,
} from '../riders/rider-pin.util';
import {
  RegisterTenderBuyerDto,
  TenderBuyerLoginDto,
} from './dto/tender-advert.dto';
import { pinProblem } from './tender-advert.util';
import { TenderBuyerJwtPayload } from './tender-buyer-auth';

/**
 * A school registers itself (name, contact, phone, county and a PIN of its own) and signs in with phone + PIN, like riders.
 * It starts PENDING: it can sign in and look around, but may only post adverts once the platform owner has checked that it is a
 * real school and approved it. 5 wrong PINs lock that account for 15 minutes; unknown number and wrong PIN get the same answer.
 */
@Injectable()
export class TenderBuyerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private pepper() {
    return this.config.getOrThrow<string>('BUYER_JWT_SECRET');
  }

  private token(id: string) {
    const payload: TenderBuyerJwtPayload = { sub: id, scope: 'tender-buyer' };
    return this.jwt.signAsync(payload);
  }

  async register(dto: RegisterTenderBuyerDto) {
    const phone = normalizeKenyanPhone(dto.phone);
    if (!phone)
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number, e.g. 0712 345 678',
      );
    const problem = pinProblem(dto.pin);
    if (problem) throw new BadRequestException(problem);
    const existing = await this.prisma.tenderBuyer.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException(
        'That phone number is already registered. Sign in instead.',
      );
    const buyer = await this.prisma.tenderBuyer.create({
      data: {
        name: dto.name.trim(),
        contactName: dto.contactName.trim(),
        phone,
        email: dto.email?.trim().toLowerCase() || null,
        county: dto.county.trim(),
        pinHash: hashPin(dto.pin, this.pepper()),
      },
    });
    return {
      accessToken: await this.token(buyer.id),
      school: this.view(buyer),
    };
  }

  async login(dto: TenderBuyerLoginDto) {
    const invalid = new UnauthorizedException(
      'The phone number or PIN is not right.',
    );
    const phone = normalizeKenyanPhone(dto.phone);
    if (!phone) throw invalid;
    const buyer = await this.prisma.tenderBuyer.findUnique({ where: { phone } });
    if (!buyer) throw invalid;
    if (buyer.pinLockedUntil && buyer.pinLockedUntil > new Date())
      throw new HttpException(
        'Too many wrong PINs. Wait 15 minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (!verifyPin(dto.pin, buyer.pinHash, this.pepper())) {
      const failures = buyer.pinFailCount + 1;
      const lock = failures >= MAX_PIN_FAILURES;
      await this.prisma.tenderBuyer.update({
        where: { id: buyer.id },
        data: {
          pinFailCount: lock ? 0 : failures,
          pinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MS) : null,
        },
      });
      if (lock)
        throw new HttpException(
          'Too many wrong PINs. Wait 15 minutes and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw invalid;
    }
    await this.prisma.tenderBuyer.update({
      where: { id: buyer.id },
      data: { pinFailCount: 0, pinLockedUntil: null, lastLoginAt: new Date() },
    });
    return {
      accessToken: await this.token(buyer.id),
      school: this.view(buyer),
    };
  }

  view(b: {
    id: string;
    name: string;
    contactName: string;
    phone: string;
    email: string | null;
    county: string;
    status: TenderBuyerStatus;
    statusNote: string | null;
  }) {
    return {
      id: b.id,
      name: b.name,
      contactName: b.contactName,
      phone: b.phone,
      email: b.email,
      county: b.county,
      status: b.status,
      statusNote: b.statusNote,
    };
  }
}
