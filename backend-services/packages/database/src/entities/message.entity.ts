import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampedEntity } from './base.entity';
import { MessageRole, PG_ENUM_TYPES } from '../enums';
import { Conversation } from './conversation.entity';

@Entity({ name: 'messages' })
@Index('IDX_messages_conversation_id', ['conversationId'])
@Index('IDX_messages_role', ['role'])
@Index('IDX_messages_created_date', ['createdDate'])
export class Message extends TimestampedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: MessageRole,
    enumName: PG_ENUM_TYPES.messageRole,
  })
  role!: MessageRole;

  @Column({ name: 'text', type: 'text' })
  text!: string;

  @Column({ name: 'is_mcp_apps', type: 'boolean', default: false })
  isMCPApps!: boolean;

  @Column({ name: 'mcp_app_link', type: 'varchar', length: 2048, nullable: true })
  MCPAppLink!: string | null;

  @Column({ name: 'mcp_active', type: 'boolean', nullable: true })
  MCPActive!: boolean | null;

  @Column({ name: 'created_date', type: 'timestamptz' })
  createdDate!: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;
}
