import { prisma } from "@formbricks/database";
import { DatabaseError } from "@formbricks/types/v1/errors";
import { TTeam } from "@formbricks/types/v1/teams";
import { createId } from "@paralleldrive/cuid2";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import {
  ChurnResponses,
  ChurnSurvey,
  DEMO_COMPANIES,
  DEMO_NAMES,
  EASResponses,
  EASSurvey,
  InterviewPromptResponses,
  InterviewPromptSurvey,
  OnboardingResponses,
  OnboardingSurvey,
  PMFResponses,
  PMFSurvey,
  generateAttributeValue,
  generateResponsesAndDisplays,
  populateEnvironment,
  updateEnvironmentArgs,
} from "../utils/createDemoProductHelpers";
import { validateInputs } from "../utils/validate";
import { ZId } from "@formbricks/types/v1/environment";

export const select = {
  id: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  plan: true,
  stripeCustomerId: true,
};

export const getTeamsByUserId = cache(async (userId: string): Promise<TTeam[]> => {
  try {
    const teams = await prisma.team.findMany({
      where: {
        memberships: {
          some: {
            userId,
          },
        },
      },
      select,
    });

    return teams;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
});

export const getTeamByEnvironmentId = cache(async (environmentId: string): Promise<TTeam | null> => {
  validateInputs([environmentId, ZId]);
  try {
    const team = await prisma.team.findFirst({
      where: {
        products: {
          some: {
            environments: {
              some: {
                id: environmentId,
              },
            },
          },
        },
      },
      select,
    });

    return team;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
});

export const deleteTeam = async (teamId: string) => {
  validateInputs([teamId, ZId]);
  try {
    await prisma.team.delete({
      where: {
        id: teamId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError("Database operation failed");
    }

    throw error;
  }
};

export const createDemoProduct = cache(async (teamId: string) => {
  validateInputs([teamId, ZId]);
  const productWithEnvironment = Prisma.validator<Prisma.ProductArgs>()({
    include: {
      environments: true,
    },
  });

  type ProductWithEnvironment = Prisma.ProductGetPayload<typeof productWithEnvironment>;

  const demoProduct: ProductWithEnvironment = await prisma.product.create({
    data: {
      name: "Demo Product",
      team: {
        connect: {
          id: teamId,
        },
      },
      environments: {
        create: [
          {
            type: "production",
            ...populateEnvironment,
          },
          {
            type: "development",
            ...populateEnvironment,
          },
        ],
      },
    },
    include: {
      environments: true,
    },
  });

  const prodEnvironment = demoProduct.environments.find((environment) => environment.type === "production");

  // add attributes to each environment of the product
  // dont add dev environment

  const updatedEnvironment = await prisma.environment.update({
    where: { id: prodEnvironment?.id },
    data: {
      ...updateEnvironmentArgs,
    },
    include: {
      attributeClasses: true, // include attributeClasses
      eventClasses: true, // include eventClasses
    },
  });

  const eventClasses = updatedEnvironment.eventClasses;

  // check if updatedEnvironment exists and it has attributeClasses
  if (!updatedEnvironment || !updatedEnvironment.attributeClasses) {
    throw new Error("Attribute classes could not be created");
  }

  const attributeClasses = updatedEnvironment.attributeClasses;

  // create an array for all the events that will be created
  const eventPromises: {
    eventClassId: string;
    sessionId: string;
  }[] = [];

  // create an array for all the attributes that will be created
  const generatedAttributes: {
    attributeClassId: string;
    value: string;
    personId: string;
  }[] = [];

  // create an array containing all the person ids to be created
  const personIds = Array.from({ length: 20 }).map((_) => createId());

  // create an array containing all the session ids to be created
  const sessionIds = Array.from({ length: 20 }).map((_) => createId());

  // loop over the person ids and create attributes for each person
  personIds.forEach((personId, i: number) => {
    generatedAttributes.push(
      ...attributeClasses.map((attributeClass) => {
        let value = generateAttributeValue(
          attributeClass.name,
          DEMO_NAMES[i],
          DEMO_COMPANIES[i],
          `${DEMO_COMPANIES[i].toLowerCase().split(" ").join("")}.com`,
          i
        );

        return {
          attributeClassId: attributeClass.id,
          value: value,
          personId,
        };
      })
    );
  });

  sessionIds.forEach((sessionId) => {
    for (let eventClass of eventClasses) {
      // create a random number of events for each event class
      const eventCount = Math.floor(Math.random() * 5) + 1;
      for (let j = 0; j < eventCount; j++) {
        eventPromises.push({
          eventClassId: eventClass.id,
          sessionId,
        });
      }
    }
  });

  // create the people, sessions, attributes, and events in a transaction
  // the order of the queries is important because of foreign key constraints
  try {
    await prisma.$transaction([
      prisma.person.createMany({
        data: personIds.map((personId) => ({
          id: personId,
          environmentId: demoProduct.environments[0].id,
        })),
      }),

      prisma.session.createMany({
        data: sessionIds.map((sessionId, idx) => ({
          id: sessionId,
          personId: personIds[idx],
        })),
      }),

      prisma.attribute.createMany({
        data: generatedAttributes,
      }),

      prisma.event.createMany({
        data: eventPromises.map((eventPromise) => ({
          eventClassId: eventPromise.eventClassId,
          sessionId: eventPromise.sessionId,
        })),
      }),
    ]);
  } catch (err: any) {
    throw new Error(err);
  }

  // Create a function that creates a survey
  const createSurvey = async (surveyData: any, responses: any, displays: any) => {
    return await prisma.survey.create({
      data: {
        ...surveyData,
        environment: { connect: { id: demoProduct.environments[0].id } },
        questions: surveyData.questions as any,
        responses: { create: responses },
        displays: { create: displays },
      },
    });
  };

  const people = personIds.map((personId) => ({ id: personId }));
  const PMFResults = generateResponsesAndDisplays(people, PMFResponses);
  const OnboardingResults = generateResponsesAndDisplays(people, OnboardingResponses);
  const ChurnResults = generateResponsesAndDisplays(people, ChurnResponses);
  const EASResults = generateResponsesAndDisplays(people, EASResponses);
  const InterviewPromptResults = generateResponsesAndDisplays(people, InterviewPromptResponses);

  // Create the surveys
  await createSurvey(PMFSurvey, PMFResults.responses, PMFResults.displays);
  await createSurvey(OnboardingSurvey, OnboardingResults.responses, OnboardingResults.displays);
  await createSurvey(ChurnSurvey, ChurnResults.responses, ChurnResults.displays);
  await createSurvey(EASSurvey, EASResults.responses, EASResults.displays);
  await createSurvey(
    InterviewPromptSurvey,
    InterviewPromptResults.responses,
    InterviewPromptResults.displays
  );

  return demoProduct;
});
