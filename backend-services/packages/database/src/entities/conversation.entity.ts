import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { User } from './user.entity';
import { Message } from './message.entity';

@Entity({ name: 'conversations' })
@Index('IDX_conversations_user_id', ['userId'])
@Index('IDX_conversations_created_date', ['createdDate'])
export class Conversation extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'created_date', type: 'timestamptz' })
  createdDate!: Date;

  @ManyToOne(() => User, (user) => user.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];
}
