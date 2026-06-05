import { FastifyReply, FastifyRequest } from 'fastify';
import { UsersService } from './users.service';
import {
  UpdateUserSchema,
  ChangePasswordSchema,
  InviteUserSchema,
  UpdateRoleSchema,
} from './users.schema';
import { successResponse, createdResponse } from '../../shared/utils/response';

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  async list(request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) {
    const result = await this.usersService.findAll(request.companyId, request.query);
    return reply.send(successResponse(result));
  }

  async getOne(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
    const user = await this.usersService.findOne(request.companyId, request.params.userId);
    return reply.send(successResponse(user));
  }

  async updateMe(request: FastifyRequest, reply: FastifyReply) {
    const input = UpdateUserSchema.parse(request.body);
    const user = await this.usersService.update(request.companyId, request.userId, input);
    return reply.send(successResponse(user, 'Profile updated'));
  }

  async changePassword(request: FastifyRequest, reply: FastifyReply) {
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(request.body);
    await this.usersService.changePassword(request.userId, currentPassword, newPassword);
    return reply.status(204).send();
  }

  async invite(request: FastifyRequest, reply: FastifyReply) {
    const input = InviteUserSchema.parse(request.body);
    const result = await this.usersService.invite(request.companyId, input);
    return reply.status(201).send(createdResponse(result, 'User invited'));
  }

  async updateRole(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { role } = UpdateRoleSchema.parse(request.body);
    const user = await this.usersService.updateRole(request.companyId, request.params.userId, role);
    return reply.send(successResponse(user, 'Role updated'));
  }

  async deactivate(
    request: FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply,
  ) {
    await this.usersService.deactivate(request.companyId, request.params.userId, request.userId);
    return reply.status(204).send();
  }
}
