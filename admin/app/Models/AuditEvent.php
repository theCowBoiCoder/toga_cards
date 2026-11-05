<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['user_id', 'operation', 'parameters', 'outcome', 'status_code'])]
class AuditEvent extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return ['parameters' => 'array'];
    }
}
