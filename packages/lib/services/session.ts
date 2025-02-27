"use server";
import "server-only";

import { prisma } from "@formbricks/database";
import { DatabaseError } from "@formbricks/types/v1/errors";
import { TSession, TSessionWithActions } from "@formbricks/types/v1/sessions";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { validateInputs } from "../utils/validate";
import { ZId } from "@formbricks/types/v1/environment";

const select = {
  id: true,
  createdAt: true,
  updatedAt: true,
  expiresAt: true,
  personId: true,
};

const oneHour = 1000 * 60 * 60;

export const getSession = async (sessionId: string): Promise<TSession | null> => {
  validateInputs([sessionId, ZId]);
  try {
    const session = await prisma.session.findUnique({
      where: {
        id: sessionId,
      },
      select,
    });

    return session;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
};

export const getSessionWithActionsOfPerson = async (
  personId: string
): Promise<TSessionWithActions[] | null> => {
  validateInputs([personId, ZId]);
  try {
    const sessionsWithActionsForPerson = await prisma.session.findMany({
      where: {
        personId,
      },
      select: {
        id: true,
        events: {
          select: {
            id: true,
            createdAt: true,
            eventClass: {
              select: {
                name: true,
                description: true,
                type: true,
              },
            },
          },
        },
      },
    });
    if (!sessionsWithActionsForPerson) return null;

    return sessionsWithActionsForPerson;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }
    throw error;
  }
};

export const getSessionCount = cache(async (personId: string): Promise<number> => {
  validateInputs([personId, ZId]);
  try {
    const sessionCount = await prisma.session.count({
      where: {
        personId,
      },
    });
    return sessionCount;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }
    throw error;
  }
});

export const createSession = async (personId: string): Promise<TSession> => {
  validateInputs([personId, ZId]);
  try {
    const session = await prisma.session.create({
      data: {
        person: {
          connect: {
            id: personId,
          },
        },
        expiresAt: new Date(Date.now() + oneHour),
      },
      select,
    });

    return session;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
};

export const extendSession = async (sessionId: string): Promise<TSession> => {
  validateInputs([sessionId, ZId]);
  try {
    const session = await prisma.session.update({
      where: {
        id: sessionId,
      },
      data: {
        expiresAt: new Date(Date.now() + oneHour),
      },
      select,
    });

    return session;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
};
