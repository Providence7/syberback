import Joi from 'joi';

export const styleSchema = Joi.object({
  title: Joi.string().required(),
  type: Joi.string().required(),
  gender: Joi.string().required(),
  ageGroup: Joi.string().required(),
  identity: Joi.string().required(),
  yardsRequired: Joi.number().required(),
  colour: Joi.string().required(),
  recommendedMaterials: Joi.array().items(Joi.string()).required(),
  price: Joi.number().required(),
  image: Joi.string().uri().required(),
  description: Joi.string().required(),
  details: Joi.string().required()
});
