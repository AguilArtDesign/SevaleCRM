import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Punto de venta del usuario que opera el panel de Puntos Colombia.
 *
 * El `LocationCode` no es de la empresa sino de cada usuario: dos comerciales pueden compartirlo, pero
 * ninguno puede usar el de otro. Por eso vive en la ficha y se resuelve en cada petición con el
 * usuario autenticado, en lugar de leerse del entorno como antes.
 *
 * Sin código el usuario no opera el programa. Se responde antes de llamar al proveedor: enviar la
 * petición sin código —o con el de otro— solo conseguiría un `POS_LOCATION_NOT_FOUND` o un
 * `POS_LOCATION_NOT_OF_PARTNER`, que no le dicen nada a quien está en el mostrador.
 */
@Injectable()
export class PointsLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async requireLocationCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pcoLocationCode: true },
    });
    const locationCode = user?.pcoLocationCode?.trim();
    if (!locationCode) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'POINTS_LOCATION_NOT_CONFIGURED',
          // Corto a propósito: lo lee el comercial en el mostrador, y el motivo real —falta el código
          // de punto de venta en su ficha— lo resuelve el administrador desde Usuarios.
          message: 'Tu usuario no tiene permisos.',
        },
      });
    }
    return locationCode;
  }
}
