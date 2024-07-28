import mongoose, { Schema } from "mongoose";

const commentSchema = mongoose.Schema({
    
    novel_id: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'novels'
    },
    novel_publisher: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'users',
    },
    comment: {
        type: String,
        required: true
    },
    children: {
        type: [ Schema.Types.ObjectId ],
        ref: 'comments'
    },
    commented_by: {
        type: Schema.Types.ObjectId,
        require: true,
        ref: 'users'
    },
    isReply: {
        type: Boolean,
        default: false,
    },
    parent: {
        type: Schema.Types.ObjectId,
        ref: 'comments'
    }
},
{
    timestamps: {
        createdAt: 'commentedAt'
    }
})

 export default mongoose.model("comments", commentSchema)