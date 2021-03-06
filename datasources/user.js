const { DataSource } = require('apollo-datasource')
const isEmail = require('isemail')
const bcrypt = require('bcryptjs')
const { UserInputError } = require('apollo-server-express')

const User = require('../models/User') 
const Pair = require('../models/Pair') 

class UserAPI extends DataSource {
  constructor() {
    super()
  }

  initialize(config) {
    this.context = config.context
  }

  async createNewUser({ email, password, name }) {
    try {
      if(!isEmail.validate(email)) { throw new Error('Invalide Email') }
      const existingUser = await User.findOne({ email })
      if(existingUser) { throw new Error('User already exists') }
      const hashedPassword = await bcrypt.hash(password, 12)
      const user = await new User({
        name,
        email,
        password: hashedPassword
      })
      await user.save()
      return true 
    } catch (error) { throw error }
  }

  async loginUser({ email, password, req }) {
    try {
      if (!isEmail.validate(email)) { throw new Error('Invalide Email') }
      const user = await User.findOne({ email }) 
      if(!user) { throw new UserInputError('Email or password is incorrect!') }
      const isEqual = await bcrypt.compare(password, user.password)
      if(!isEqual) { throw new UserInputError('Email or password is incorrect!') }
      req.session.userId = user.id 
      return user 
    } catch (error) { throw error }
  }

  async newPosition({ pair, lotSize, openedAt, position, req }) {
    try {
      const user = await User.findById(req.session.userId)
      if(!user) throw new Error(`User doesn't exist.`)
      if(user.bankroll < lotSize) throw new Error(`You don't have enough for this transaction.`)
      
      const newPair = new Pair({
        pair,
        lotSize,
        openedAt,
        position,
        open: true,
        user: req.session.userId
      })
      const pairResult = await newPair.save()
      user.pairs.unshift(pairResult)
      user.bankroll -= lotSize
      await user.save()
      const message = `Congrats ${user.name}! You've opened a ${position} position on ${pair} at ${openedAt}`
      const success = true
      return { success, message, pair: pairResult }
    } catch (error) { throw error }
  }

  async exitPosition({ id, closedAt, req }) {
    try {
      const pair = await Pair.findById(id) 
      if(!pair) throw new Error('Pair not found')
      if(!pair.open) throw new Error('Transaction already complete!')
      let pipDifFloat
      pair.position === 'long' 
        ? pipDifFloat = (closedAt - pair.openedAt).toFixed(4) 
        : pipDifFloat = (pair.openedAt - closedAt).toFixed(4)   
      pair.closedAt = closedAt
      pair.pipDif = pipDifFloat
      pair.profitLoss = pipDifFloat * pair.lotSize
      pair.open = false 
      const savedPair = await pair.save()
      const user = await User.findById(req.session.userId) 
      user.bankroll += (pair.lotSize + savedPair.profitLoss) 
      await user.save() 

      const success = true 
      const message = `${savedPair.profitLoss > 0 ? `Congrats! ` : ''}${user.name} you've closed your ${savedPair.position} position on ${savedPair.pair} at ${closedAt}${savedPair.profitLoss > 0 ? '! For a profit of '+Math.round(savedPair.profitLoss) : '! For a loss of '+Math.round(savedPair.profitLoss)}`
      return { success, message, pair: savedPair }
    }
    catch (error) { throw error }
  }

  async getPair({ id, req }) {
    const user = await User.findById(req.session.userId)
    const pair = await Pair.findById(id)
    if(!pair || pair.user.toString() !== user.id.toString()) { throw new Error('Invalid credentials!') }
    else { return pair }
  }

  async findPairs({ req }) {
    const pairs = await Pair.find({ user: req.session.userId })
    if(!pairs.length) throw new Error('Nothing to show!')
    return [...pairs] 
  }

  async getMe({ req }) {
    if(!req.session.userId) return null 
    const user = await User.findById(req.session.userId).populate('pairs') 
    return user 
  }
}

module.exports = UserAPI